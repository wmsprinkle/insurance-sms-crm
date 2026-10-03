import { z } from "zod";
import { e164 } from "./phone";

export const CALENDAR_BOOK_PATH = "/internal/calendar/book";

export const CALENDAR_EVENT_ID_PATTERN = /^[a-v0-9]{5,1024}$/;

const leadFields = {
	contactId: z.string().trim().min(1),
	phone: e164,
	state: z
		.string()
		.trim()
		.regex(/^[A-Za-z]{2}$/)
		.nullable(),
};

export const calendarAvailableSlotsRequest = z.object({
	action: z.literal("availableSlots"),
	...leadFields,
});

export const calendarBookRequest = z
	.object({
		action: z.literal("book"),
		...leadFields,
		start: z.iso.datetime({ offset: true }),
		end: z.iso.datetime({ offset: true }),
		timeZone: z.string().trim().min(1).max(100),
		summary: z.string().trim().min(1).max(1024),
		description: z.string().max(8192),
		attendee: z
			.object({
				email: z.email(),
				name: z.string().trim().min(1).max(200).nullable(),
			})
			.nullable(),
		requestId: z.string().trim().min(1).max(200),
		eventId: z.string().regex(CALENDAR_EVENT_ID_PATTERN),
	})
	.refine((input) => Date.parse(input.end) > Date.parse(input.start), {
		message: "The meeting must end after it starts.",
		path: ["end"],
	});

export const calendarBridgeRequest = z.union([
	calendarAvailableSlotsRequest,
	calendarBookRequest,
]);

export type CalendarAvailableSlotsRequest = z.infer<
	typeof calendarAvailableSlotsRequest
>;
export type CalendarBookRequest = z.infer<typeof calendarBookRequest>;
export type CalendarBridgeRequest = z.infer<typeof calendarBridgeRequest>;

export const calendarSlot = z.object({
	start: z.iso.datetime({ offset: true }),
	end: z.iso.datetime({ offset: true }),
});

export type CalendarSlot = z.infer<typeof calendarSlot>;

export const CALENDAR_UNAVAILABLE_REASONS = [
	"no-owner",
	"not-connected",
	"needs-reconsent",
	"needs-reconnect",
	"rate-limited",
	"invalid-input",
	"failed",
] as const;

export type CalendarUnavailableReason =
	(typeof CALENDAR_UNAVAILABLE_REASONS)[number];

export const calendarBridgeResponse = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("slots"),
		ownerUserId: z.string().min(1),
		timeZone: z.string().min(1),
		slots: z.array(calendarSlot),
	}),
	z.object({
		status: z.literal("booked"),
		ownerUserId: z.string().min(1),
		organizerEmail: z.string().nullable(),
		eventId: z.string().min(1),
		iCalUID: z.string().nullable(),
		htmlLink: z.string().nullable(),
		meetUrl: z.string().nullable(),
		duplicate: z.boolean(),
	}),
	z.object({
		status: z.literal("slot-taken"),
		timeZone: z.string().min(1),
		slots: z.array(calendarSlot),
	}),
	z.object({
		status: z.literal("unavailable"),
		reason: z.enum(CALENDAR_UNAVAILABLE_REASONS),
		detail: z.string(),
		retryable: z.boolean(),
	}),
]);

export type CalendarBridgeResponse = z.infer<typeof calendarBridgeResponse>;

export function parseCalendarBridgeResponse(
	value: unknown,
): CalendarBridgeResponse {
	const parsed = calendarBridgeResponse.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`Unreadable calendar bridge response: ${parsed.error.issues
				.map(
					(issue) => `${issue.path.join(".") || "response"} ${issue.message}`,
				)
				.join("; ")}`,
		);
	}
	return parsed.data;
}
