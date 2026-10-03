import { z } from "zod";
import type { Interval } from "./calendar-write.slots";

const googleError = z.object({
	domain: z.string().optional(),
	reason: z.string(),
});

const busyBlock = z.object({
	start: z.iso.datetime({ offset: true }),
	end: z.iso.datetime({ offset: true }),
});

export const freeBusyResponse = z.object({
	timeMin: z.string().optional(),
	timeMax: z.string().optional(),
	calendars: z.record(
		z.string(),
		z.object({
			busy: z.array(busyBlock).default([]),
			errors: z.array(googleError).optional(),
		}),
	),
});

export type FreeBusyResponse = z.infer<typeof freeBusyResponse>;

export const insertedEvent = z.object({
	id: z.string().min(1),
	status: z.string().optional(),
	htmlLink: z.string().optional(),
	hangoutLink: z.string().optional(),
	iCalUID: z.string().optional(),
	conferenceData: z
		.object({
			entryPoints: z
				.array(
					z.object({
						entryPointType: z.string().optional(),
						uri: z.string().optional(),
					}),
				)
				.optional(),
			createRequest: z
				.object({
					status: z.object({ statusCode: z.string() }).optional(),
				})
				.optional(),
		})
		.optional(),
});

export type InsertedEvent = z.infer<typeof insertedEvent>;

export const googleErrorBody = z.object({
	error: z
		.object({
			message: z.string().optional(),
			status: z.string().optional(),
			code: z.union([z.string(), z.number()]).optional(),
		})
		.optional(),
});

export const bookingAttendee = z.object({
	email: z.email(),
	displayName: z.string().trim().min(1).max(200).optional(),
});

export const bookingInput = z
	.object({
		calendarId: z.string().trim().min(1).optional(),
		summary: z.string().trim().min(1).max(1024),
		description: z.string().max(8192).optional(),
		start: z.date(),
		end: z.date(),
		timeZone: z.string().trim().min(1),
		attendees: z.array(bookingAttendee).max(50),
		requestId: z.string().trim().min(1).max(200),
		eventId: z
			.string()
			.regex(/^[a-v0-9]{5,1024}$/)
			.optional(),
	})
	.refine((input) => input.end.getTime() > input.start.getTime(), {
		message: "The event must end after it starts.",
		path: ["end"],
	});

export type BookingInput = z.infer<typeof bookingInput>;

export type FreeBusyQuery = {
	timeMin: Date;
	timeMax: Date;
	timeZone: string;
	calendarIds?: readonly string[];
};

export type BookedEvent = {
	eventId: string;
	htmlLink: string | null;
	meetUrl: string | null;
	iCalUID: string | null;
	conferenceStatus: string | null;
};

export type CalendarWriteFailure =
	| { outcome: "needs-reconsent"; reason: string; missingScopes: string[] }
	| { outcome: "not-connected"; reason: string }
	| { outcome: "needs-reconnect"; reason: string }
	| { outcome: "invalid-input"; reason: string }
	| { outcome: "slot-taken"; reason: string; busy: Interval[] }
	| { outcome: "duplicate"; reason: string }
	| { outcome: "rate-limited"; reason: string; retryAfterMs: number }
	| { outcome: "failed"; reason: string; retryable: boolean };

export type CalendarWriteResult<T> =
	| { outcome: "ok"; data: T }
	| CalendarWriteFailure;
