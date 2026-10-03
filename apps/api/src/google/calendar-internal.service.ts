import { GOOGLE_PROVIDER_ID } from "@crm/auth/scopes";
import type { Db } from "@crm/db";
import { SETTINGS_ID } from "@crm/db/settings";
import type {
	CalendarAvailableSlotsRequest,
	CalendarBookRequest,
	CalendarBridgeRequest,
	CalendarBridgeResponse,
} from "@crm/validation/calendar-book";
import { parseCalendarSettings } from "@crm/validation/calendar-settings";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	leadTimeZone,
	noOwner,
	slotsOut,
	unavailable,
} from "./calendar-internal";
import { CalendarWriteClient } from "./calendar-write.client";

export const CALENDAR_CLOCK = Symbol("CALENDAR_CLOCK");

export type CalendarClock = () => Date;

type CalendarWriter = Pick<CalendarWriteClient, "availableSlots" | "bookSlot">;

@Injectable()
export class CalendarInternalService {
	private readonly logger = new Logger(CalendarInternalService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(CalendarWriteClient) private readonly calendar: CalendarWriter,
		@Inject(CALENDAR_CLOCK) private readonly now: CalendarClock,
	) {}

	handle(request: CalendarBridgeRequest): Promise<CalendarBridgeResponse> {
		return request.action === "book"
			? this.book(request)
			: this.availableSlots(request);
	}

	async ownerUserId(): Promise<string | null> {
		const row = await this.db.appSetting.findUnique({
			where: { id: SETTINGS_ID },
			select: { calendar: true },
		});
		const chosen = parseCalendarSettings(row?.calendar).ownerUserId;
		if (chosen) return chosen;

		const first = await this.db.account.findFirst({
			where: { providerId: GOOGLE_PROVIDER_ID },
			orderBy: { createdAt: "asc" },
			select: { userId: true },
		});
		return first?.userId ?? null;
	}

	private async availableSlots(
		request: CalendarAvailableSlotsRequest,
	): Promise<CalendarBridgeResponse> {
		const ownerUserId = await this.ownerUserId();
		if (!ownerUserId) return noOwner();

		const timeZone = leadTimeZone(request.phone, request.state);
		const result = await this.calendar.availableSlots(ownerUserId, {
			now: this.now(),
			timeZone,
		});
		if (result.outcome !== "ok") return unavailable(result);

		return {
			status: "slots",
			ownerUserId,
			timeZone,
			slots: slotsOut(result.data),
		};
	}

	private async book(
		request: CalendarBookRequest,
	): Promise<CalendarBridgeResponse> {
		const ownerUserId = await this.ownerUserId();
		if (!ownerUserId) return noOwner();

		const result = await this.calendar.bookSlot(ownerUserId, {
			summary: request.summary,
			description: request.description,
			start: new Date(request.start),
			end: new Date(request.end),
			timeZone: request.timeZone,
			attendees: request.attendee
				? [
						{
							email: request.attendee.email,
							displayName: request.attendee.name ?? undefined,
						},
					]
				: [],
			requestId: request.requestId,
			eventId: request.eventId,
		});

		if (result.outcome === "ok" || result.outcome === "duplicate") {
			const owner = await this.db.user.findUnique({
				where: { id: ownerUserId },
				select: { email: true },
			});
			const booked = result.outcome === "ok" ? result.data : null;
			this.logger.log({
				message: "Agent booked a meeting",
				contactId: request.contactId,
				duplicate: booked === null,
			});
			return {
				status: "booked",
				ownerUserId,
				organizerEmail: owner?.email ?? null,
				eventId: booked?.eventId ?? request.eventId,
				iCalUID: booked?.iCalUID ?? null,
				htmlLink: booked?.htmlLink ?? null,
				meetUrl: booked?.meetUrl ?? null,
				duplicate: booked === null,
			};
		}

		if (result.outcome === "slot-taken") {
			const timeZone = leadTimeZone(request.phone, request.state);
			const fresh = await this.calendar.availableSlots(ownerUserId, {
				now: this.now(),
				timeZone,
			});
			return {
				status: "slot-taken",
				timeZone,
				slots: fresh.outcome === "ok" ? slotsOut(fresh.data) : [],
			};
		}

		return unavailable(result);
	}
}
