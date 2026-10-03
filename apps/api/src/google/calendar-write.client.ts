import { BOOKING_SCOPES, GOOGLE_PROVIDER_ID } from "@crm/auth/scopes";
import { Logger } from "@nestjs/common";
import { type z } from "zod";
import type { MailboxTokenService } from "../mailbox/mailbox-token.service";
import { conferenceUrl } from "./calendar.client";
import { CALENDAR_WRITE, MINUTE_MS } from "./calendar-write.config";
import {
	type BookedEvent,
	type BookingInput,
	bookingInput,
	type CalendarWriteFailure,
	type CalendarWriteResult,
	type FreeBusyQuery,
	freeBusyResponse,
	googleErrorBody,
	type InsertedEvent,
	insertedEvent,
} from "./calendar-write.contracts";
import {
	generateSlots,
	type Interval,
	isTimeZone,
	overlaps,
	type Slot,
	type SlotOptions,
	slotSearchWindow,
} from "./calendar-write.slots";

export type CalendarFetch = (
	input: string | URL,
	init?: RequestInit,
) => Promise<Response>;

export type CalendarTokens = Pick<
	MailboxTokenService,
	"grantedScopes" | "accessTokenFor"
>;

export const CALENDAR_FETCH = Symbol("CALENDAR_FETCH");

export type AvailableSlotsOptions = Omit<SlotOptions, "busy"> & {
	calendarIds?: readonly string[];
};

type TokenOutcome =
	| { outcome: "ok"; accessToken: string }
	| CalendarWriteFailure;

type RequestPlan<T> = {
	method: "GET" | "POST";
	path: string;
	accessToken: string;
	schema: z.ZodType<T>;
	params?: Record<string, string>;
	body?: unknown;
};

export class CalendarWriteClient {
	private readonly logger = new Logger(CalendarWriteClient.name);

	constructor(
		private readonly tokens: CalendarTokens,
		private readonly fetcher: CalendarFetch,
	) {}

	async freeBusy(
		userId: string,
		query: FreeBusyQuery,
	): Promise<CalendarWriteResult<Interval[]>> {
		const token = await this.accessToken(userId);
		if (token.outcome !== "ok") return token;

		return this.queryFreeBusy(token.accessToken, query);
	}

	async availableSlots(
		userId: string,
		options: AvailableSlotsOptions,
	): Promise<CalendarWriteResult<Slot[]>> {
		if (!isTimeZone(options.timeZone)) {
			return {
				outcome: "invalid-input",
				reason: `Unknown time zone: ${options.timeZone}`,
			};
		}

		const window = slotSearchWindow(options);
		const busy = await this.freeBusy(userId, {
			timeMin: window.start,
			timeMax: window.end,
			timeZone: options.timeZone,
			calendarIds: options.calendarIds,
		});
		if (busy.outcome !== "ok") return busy;

		return {
			outcome: "ok",
			data: generateSlots({ ...options, busy: busy.data }),
		};
	}

	async insertEvent(
		userId: string,
		input: BookingInput,
	): Promise<CalendarWriteResult<BookedEvent>> {
		const parsed = bookingInput.safeParse(input);
		if (!parsed.success) {
			return { outcome: "invalid-input", reason: parsed.error.message };
		}

		const token = await this.accessToken(userId);
		if (token.outcome !== "ok") return token;

		return this.insert(token.accessToken, parsed.data);
	}

	async bookSlot(
		userId: string,
		input: BookingInput,
	): Promise<CalendarWriteResult<BookedEvent>> {
		const parsed = bookingInput.safeParse(input);
		if (!parsed.success) {
			return { outcome: "invalid-input", reason: parsed.error.message };
		}

		const token = await this.accessToken(userId);
		if (token.outcome !== "ok") return token;

		const booking = parsed.data;
		const bufferMs = CALENDAR_WRITE.slots.bufferMinutes * MINUTE_MS;
		const guarded = {
			start: new Date(booking.start.getTime() - bufferMs),
			end: new Date(booking.end.getTime() + bufferMs),
		};

		const recheck = await this.queryFreeBusy(token.accessToken, {
			timeMin: guarded.start,
			timeMax: guarded.end,
			timeZone: booking.timeZone,
			calendarIds: [calendarIdOf(booking)],
		});
		if (recheck.outcome !== "ok") return recheck;

		const conflicts = recheck.data.filter((busy) => overlaps(guarded, busy));
		if (conflicts.length > 0) {
			return {
				outcome: "slot-taken",
				reason: "The calendar is no longer free at that time.",
				busy: conflicts,
			};
		}

		return this.insert(token.accessToken, booking);
	}

	private async accessToken(userId: string): Promise<TokenOutcome> {
		const granted = await this.tokens.grantedScopes(userId, GOOGLE_PROVIDER_ID);
		const missingScopes = BOOKING_SCOPES.filter((scope) => !granted.has(scope));

		if (missingScopes.length > 0) {
			return {
				outcome: "needs-reconsent",
				reason: "Google has not granted calendar booking access.",
				missingScopes,
			};
		}

		return this.tokens.accessTokenFor(userId, "calendar");
	}

	private async queryFreeBusy(
		accessToken: string,
		query: FreeBusyQuery,
	): Promise<CalendarWriteResult<Interval[]>> {
		const calendarIds = query.calendarIds?.length
			? query.calendarIds
			: [CALENDAR_WRITE.api.primaryCalendarId];

		const response = await this.request({
			method: "POST",
			path: "/freeBusy",
			accessToken,
			schema: freeBusyResponse,
			body: {
				timeMin: query.timeMin.toISOString(),
				timeMax: query.timeMax.toISOString(),
				timeZone: query.timeZone,
				items: calendarIds.map((id) => ({ id })),
			},
		});
		if (response.outcome !== "ok") return response;

		const calendars = Object.values(response.data.calendars);
		const errors = calendars.flatMap((calendar) => calendar.errors ?? []);
		if (errors.length > 0) {
			return {
				outcome: "failed",
				reason: `Free/busy failed: ${errors.map((error) => error.reason).join(", ")}.`,
				retryable: errors.every((error) => error.reason === "backendError"),
			};
		}

		const busy = calendars
			.flatMap((calendar) => calendar.busy)
			.map((block) => ({
				start: new Date(block.start),
				end: new Date(block.end),
			}))
			.sort((a, b) => a.start.getTime() - b.start.getTime());

		return { outcome: "ok", data: busy };
	}

	private async insert(
		accessToken: string,
		booking: BookingInput,
	): Promise<CalendarWriteResult<BookedEvent>> {
		const response = await this.request({
			method: "POST",
			path: `/calendars/${encodeURIComponent(calendarIdOf(booking))}/events`,
			accessToken,
			schema: insertedEvent,
			params: { sendUpdates: "all", conferenceDataVersion: "1" },
			body: eventBody(booking),
		});
		if (response.outcome !== "ok") return response;

		return { outcome: "ok", data: bookedEvent(response.data) };
	}

	private async request<T>(
		plan: RequestPlan<T>,
	): Promise<CalendarWriteResult<T>> {
		const target = new URL(`${CALENDAR_WRITE.api.baseUrl}${plan.path}`);
		for (const [key, value] of Object.entries(plan.params ?? {})) {
			target.searchParams.set(key, value);
		}

		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			CALENDAR_WRITE.api.timeoutMs,
		);

		try {
			const response = await this.fetcher(target, {
				method: plan.method,
				headers: {
					authorization: `Bearer ${plan.accessToken}`,
					"content-type": "application/json",
				},
				body: plan.body === undefined ? undefined : JSON.stringify(plan.body),
				signal: controller.signal,
			});

			return await this.interpret(response, plan);
		} catch (error) {
			const aborted = error instanceof Error && error.name === "AbortError";
			return {
				outcome: "failed",
				reason: aborted
					? `Timed out after ${CALENDAR_WRITE.api.timeoutMs}ms.`
					: error instanceof Error
						? error.message
						: String(error),
				retryable: true,
			};
		} finally {
			clearTimeout(timeout);
		}
	}

	private async interpret<T>(
		response: Response,
		plan: RequestPlan<T>,
	): Promise<CalendarWriteResult<T>> {
		if (response.ok) {
			const parsed = plan.schema.safeParse(await response.json());
			if (parsed.success) return { outcome: "ok", data: parsed.data };

			this.logger.warn({
				message: "Google Calendar returned an unexpected shape",
				path: plan.path,
			});
			return {
				outcome: "failed",
				reason: `Unexpected Google Calendar response for ${plan.path}: ${parsed.error.message}`,
				retryable: false,
			};
		}

		const detail = await reasonOf(response);

		switch (response.status) {
			case 401:
				return { outcome: "needs-reconnect", reason: detail };

			case 403:
				if (/rate|quota|limitExceeded/i.test(detail)) {
					return {
						outcome: "rate-limited",
						reason: detail,
						retryAfterMs: backoffFrom(response),
					};
				}
				if (/insufficient|scope|permission/i.test(detail)) {
					return {
						outcome: "needs-reconsent",
						reason: detail,
						missingScopes: [...BOOKING_SCOPES],
					};
				}
				return { outcome: "failed", reason: detail, retryable: false };

			case 409:
				return { outcome: "duplicate", reason: detail };

			case 429:
				return {
					outcome: "rate-limited",
					reason: detail,
					retryAfterMs: backoffFrom(response),
				};

			default: {
				const retryable = response.status >= 500;
				this.logger.warn({
					message: "Google Calendar write failed",
					path: plan.path,
					status: response.status,
					retryable,
				});
				return { outcome: "failed", reason: detail, retryable };
			}
		}
	}
}

function calendarIdOf(booking: BookingInput): string {
	return booking.calendarId ?? CALENDAR_WRITE.api.primaryCalendarId;
}

function eventBody(booking: BookingInput) {
	return {
		id: booking.eventId,
		summary: booking.summary,
		description: booking.description,
		start: {
			dateTime: booking.start.toISOString(),
			timeZone: booking.timeZone,
		},
		end: { dateTime: booking.end.toISOString(), timeZone: booking.timeZone },
		attendees: booking.attendees.map((attendee) => ({
			email: attendee.email,
			displayName: attendee.displayName,
		})),
		conferenceData: {
			createRequest: {
				requestId: booking.requestId,
				conferenceSolutionKey: { type: CALENDAR_WRITE.api.meetSolution },
			},
		},
	};
}

function bookedEvent(event: InsertedEvent): BookedEvent {
	return {
		eventId: event.id,
		htmlLink: event.htmlLink ?? null,
		meetUrl: conferenceUrl(event),
		iCalUID: event.iCalUID ?? null,
		conferenceStatus:
			event.conferenceData?.createRequest?.status?.statusCode ?? null,
	};
}

function backoffFrom(response: Response): number {
	const header = response.headers.get("retry-after");
	const seconds = header ? Number(header) : Number.NaN;
	const suggested = Number.isFinite(seconds)
		? seconds * 1000
		: CALENDAR_WRITE.backoff.minMs;

	return Math.min(
		Math.max(suggested, CALENDAR_WRITE.backoff.minMs),
		CALENDAR_WRITE.backoff.maxMs,
	);
}

async function reasonOf(response: Response): Promise<string> {
	try {
		const parsed = googleErrorBody.safeParse(await response.json());
		const error = parsed.success ? parsed.data.error : undefined;
		return (
			error?.message ??
			error?.status ??
			(error?.code === undefined ? undefined : String(error.code)) ??
			`HTTP ${response.status}`
		);
	} catch {
		return `HTTP ${response.status}`;
	}
}
