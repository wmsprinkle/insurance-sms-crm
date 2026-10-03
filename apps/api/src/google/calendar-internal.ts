import type {
	CalendarBridgeResponse,
	CalendarSlot,
	CalendarUnavailableReason,
} from "@crm/validation/calendar-book";
import { localClock, sendWindowFor } from "../compliance/quiet-hours";
import { CALENDAR_WRITE } from "./calendar-write.config";
import type { CalendarWriteFailure } from "./calendar-write.contracts";
import type { Slot } from "./calendar-write.slots";

const KILOBYTE = 1024;

export const CALENDAR_INTERNAL = {
	body: { maxBytes: 32 * KILOBYTE },
	fallbackTimeZone: "America/New_York",
	errors: {
		noOwner:
			"No calendar owner: set calendar.ownerUserId or connect a Google account.",
		outsideHours:
			"The time is outside business hours in the lead's time zone. Offer the free slots instead.",
	},
} as const;

export function leadTimeZone(phone: string, state: string | null): string {
	return (
		sendWindowFor({ e164: phone, state }).timezones[0] ??
		CALENDAR_INTERNAL.fallbackTimeZone
	);
}

export function withinBusinessHours(
	start: Date,
	end: Date,
	timeZone: string,
): boolean {
	const hours = CALENDAR_WRITE.businessHours;
	const from = localClock(start, timeZone);
	const to = localClock(end, timeZone);
	const weekdays: readonly number[] = hours.weekdays;
	return (
		weekdays.includes(from.weekday) &&
		from.weekday === to.weekday &&
		from.minutes >= hours.startMinute &&
		to.minutes <= hours.endMinute &&
		to.minutes > from.minutes
	);
}

export function slotsOut(slots: readonly Slot[]): CalendarSlot[] {
	return slots.map((slot) => ({
		start: slot.start.toISOString(),
		end: slot.end.toISOString(),
	}));
}

const UNAVAILABLE_FOR = {
	"needs-reconsent": "needs-reconsent",
	"not-connected": "not-connected",
	"needs-reconnect": "needs-reconnect",
	"invalid-input": "invalid-input",
	"slot-taken": "failed",
	duplicate: "failed",
	"rate-limited": "rate-limited",
	failed: "failed",
} as const satisfies Record<
	CalendarWriteFailure["outcome"],
	CalendarUnavailableReason
>;

export function unavailable(
	failure: CalendarWriteFailure,
): Extract<CalendarBridgeResponse, { status: "unavailable" }> {
	return {
		status: "unavailable",
		reason: UNAVAILABLE_FOR[failure.outcome],
		detail: failure.reason,
		retryable:
			failure.outcome === "rate-limited" ||
			(failure.outcome === "failed" && failure.retryable),
	};
}

export function noOwner(): Extract<
	CalendarBridgeResponse,
	{ status: "unavailable" }
> {
	return {
		status: "unavailable",
		reason: "no-owner",
		detail: CALENDAR_INTERNAL.errors.noOwner,
		retryable: false,
	};
}

export function outsideBusinessHours(): Extract<
	CalendarBridgeResponse,
	{ status: "unavailable" }
> {
	return {
		status: "unavailable",
		reason: "invalid-input",
		detail: CALENDAR_INTERNAL.errors.outsideHours,
		retryable: false,
	};
}
