import { describe, expect, it } from "bun:test";
import { BOOKING_SCOPES, CALENDAR_SCOPE, GMAIL_SCOPE } from "@crm/auth/scopes";
import type { z } from "zod";
import {
	type CalendarFetch,
	type CalendarTokens,
	CalendarWriteClient,
} from "../src/google/calendar-write.client";
import type { BookingInput } from "../src/google/calendar-write.contracts";

type Call = { url: URL; method: string; body: z.core.util.JSONType | null };
type Reply = { status: number; body: z.core.util.JSONType };

const ALL_SCOPES = [GMAIL_SCOPE, CALENDAR_SCOPE, ...BOOKING_SCOPES];

function tokens(scopes: readonly string[] = ALL_SCOPES): CalendarTokens {
	return {
		grantedScopes: async () => new Set(scopes),
		accessTokenFor: async () => ({ outcome: "ok", accessToken: "token" }),
	};
}

type FakeFetch = { fetcher: CalendarFetch; calls: Call[] };

function fakeFetch(replies: Reply[]): FakeFetch {
	const calls: Call[] = [];
	const fetcher: CalendarFetch = async (input, init) => {
		calls.push({
			url: new URL(input),
			method: init?.method ?? "GET",
			body: init?.body ? JSON.parse(String(init.body)) : null,
		});
		const reply = replies.shift() ?? { status: 500, body: {} };
		return new Response(JSON.stringify(reply.body), {
			status: reply.status,
			headers: { "content-type": "application/json" },
		});
	};
	return { fetcher, calls };
}

const booking: BookingInput = {
	summary: "Insurance review",
	start: new Date("2026-10-06T13:00:00Z"),
	end: new Date("2026-10-06T13:30:00Z"),
	timeZone: "America/New_York",
	attendees: [{ email: "lead@example.com" }],
	requestId: "contact-1-2026-10-06T13",
};

const freeReply: Reply = {
	status: 200,
	body: { calendars: { primary: { busy: [] } } },
};

const insertedReply: Reply = {
	status: 200,
	body: {
		id: "evt1",
		htmlLink: "https://calendar.google.com/event?eid=evt1",
		hangoutLink: "https://meet.google.com/abc-defg-hij",
		iCalUID: "evt1@google.com",
		conferenceData: { createRequest: { status: { statusCode: "success" } } },
	},
};

describe("CalendarWriteClient.freeBusy", () => {
	it("posts the window and returns sorted busy blocks", async () => {
		const { fetcher, calls } = fakeFetch([
			{
				status: 200,
				body: {
					calendars: {
						primary: {
							busy: [
								{ start: "2026-10-06T15:00:00Z", end: "2026-10-06T16:00:00Z" },
								{ start: "2026-10-06T13:00:00Z", end: "2026-10-06T14:00:00Z" },
							],
						},
					},
				},
			},
		]);
		const client = new CalendarWriteClient(tokens(), fetcher);

		const result = await client.freeBusy("user-1", {
			timeMin: new Date("2026-10-06T00:00:00Z"),
			timeMax: new Date("2026-10-07T00:00:00Z"),
			timeZone: "America/New_York",
		});

		expect(result.outcome).toBe("ok");
		if (result.outcome !== "ok") return;
		expect(result.data.map((block) => block.start.toISOString())).toEqual([
			"2026-10-06T13:00:00.000Z",
			"2026-10-06T15:00:00.000Z",
		]);
		expect(calls[0]?.url.pathname).toBe("/calendar/v3/freeBusy");
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.body).toEqual({
			timeMin: "2026-10-06T00:00:00.000Z",
			timeMax: "2026-10-07T00:00:00.000Z",
			timeZone: "America/New_York",
			items: [{ id: "primary" }],
		});
	});

	it("fails on a per-calendar error instead of reporting the calendar free", async () => {
		const { fetcher } = fakeFetch([
			{
				status: 200,
				body: {
					calendars: {
						primary: {
							busy: [],
							errors: [{ domain: "global", reason: "notFound" }],
						},
					},
				},
			},
		]);
		const client = new CalendarWriteClient(tokens(), fetcher);

		const result = await client.freeBusy("user-1", {
			timeMin: new Date("2026-10-06T00:00:00Z"),
			timeMax: new Date("2026-10-07T00:00:00Z"),
			timeZone: "UTC",
		});

		expect(result).toEqual({
			outcome: "failed",
			reason: "Free/busy failed: notFound.",
			retryable: false,
		});
	});
});

describe("CalendarWriteClient.bookSlot", () => {
	it("re-checks free/busy, then inserts with invites and a Meet link", async () => {
		const { fetcher, calls } = fakeFetch([freeReply, insertedReply]);
		const client = new CalendarWriteClient(tokens(), fetcher);

		const result = await client.bookSlot("user-1", booking);

		expect(result).toEqual({
			outcome: "ok",
			data: {
				eventId: "evt1",
				htmlLink: "https://calendar.google.com/event?eid=evt1",
				meetUrl: "https://meet.google.com/abc-defg-hij",
				iCalUID: "evt1@google.com",
				conferenceStatus: "success",
			},
		});
		expect(calls.map((call) => call.url.pathname)).toEqual([
			"/calendar/v3/freeBusy",
			"/calendar/v3/calendars/primary/events",
		]);

		const insert = calls[1];
		expect(insert?.url.searchParams.get("sendUpdates")).toBe("all");
		expect(insert?.url.searchParams.get("conferenceDataVersion")).toBe("1");
		expect(insert?.body).toMatchObject({
			summary: "Insurance review",
			start: {
				dateTime: "2026-10-06T13:00:00.000Z",
				timeZone: "America/New_York",
			},
			end: {
				dateTime: "2026-10-06T13:30:00.000Z",
				timeZone: "America/New_York",
			},
			attendees: [{ email: "lead@example.com" }],
			conferenceData: {
				createRequest: {
					requestId: "contact-1-2026-10-06T13",
					conferenceSolutionKey: { type: "hangoutsMeet" },
				},
			},
		});
	});

	it("does not insert when the slot was taken since it was offered", async () => {
		const { fetcher, calls } = fakeFetch([
			{
				status: 200,
				body: {
					calendars: {
						primary: {
							busy: [
								{ start: "2026-10-06T13:15:00Z", end: "2026-10-06T14:00:00Z" },
							],
						},
					},
				},
			},
		]);
		const client = new CalendarWriteClient(tokens(), fetcher);

		const result = await client.bookSlot("user-1", booking);

		expect(result.outcome).toBe("slot-taken");
		expect(calls).toHaveLength(1);
	});

	it("books when the busy block only touches the slot edge", async () => {
		const { fetcher, calls } = fakeFetch([
			{
				status: 200,
				body: {
					calendars: {
						primary: {
							busy: [
								{ start: "2026-10-06T12:00:00Z", end: "2026-10-06T13:00:00Z" },
							],
						},
					},
				},
			},
			insertedReply,
		]);
		const client = new CalendarWriteClient(tokens(), fetcher);

		expect((await client.bookSlot("user-1", booking)).outcome).toBe("ok");
		expect(calls).toHaveLength(2);
	});

	it("asks for re-consent before calling Google when booking scopes are missing", async () => {
		const { fetcher, calls } = fakeFetch([]);
		const client = new CalendarWriteClient(
			tokens([GMAIL_SCOPE, CALENDAR_SCOPE]),
			fetcher,
		);

		const result = await client.bookSlot("user-1", booking);

		expect(result).toEqual({
			outcome: "needs-reconsent",
			reason: "Google has not granted calendar booking access.",
			missingScopes: [...BOOKING_SCOPES],
		});
		expect(calls).toHaveLength(0);
	});

	it("passes through a token failure", async () => {
		const { fetcher, calls } = fakeFetch([]);
		const client = new CalendarWriteClient(
			{
				grantedScopes: async () => new Set(ALL_SCOPES),
				accessTokenFor: async () => ({
					outcome: "needs-reconnect",
					reason: "Google would not refresh the access token.",
				}),
			},
			fetcher,
		);

		expect((await client.bookSlot("user-1", booking)).outcome).toBe(
			"needs-reconnect",
		);
		expect(calls).toHaveLength(0);
	});

	it("rejects a booking that ends before it starts", async () => {
		const { fetcher, calls } = fakeFetch([]);
		const client = new CalendarWriteClient(tokens(), fetcher);

		const result = await client.bookSlot("user-1", {
			...booking,
			end: booking.start,
		});

		expect(result.outcome).toBe("invalid-input");
		expect(calls).toHaveLength(0);
	});
});

describe("CalendarWriteClient.insertEvent errors", () => {
	const insertWith = async (reply: Reply) => {
		const { fetcher } = fakeFetch([reply]);
		return new CalendarWriteClient(tokens(), fetcher).insertEvent(
			"user-1",
			booking,
		);
	};

	it("maps 409 to duplicate", async () => {
		const result = await insertWith({
			status: 409,
			body: { error: { message: "The requested identifier already exists." } },
		});
		expect(result.outcome).toBe("duplicate");
	});

	it("maps an insufficient-scope 403 to needs-reconsent", async () => {
		const result = await insertWith({
			status: 403,
			body: {
				error: { message: "Request had insufficient authentication scopes." },
			},
		});
		expect(result.outcome).toBe("needs-reconsent");
	});

	it("maps 429 to rate-limited", async () => {
		const result = await insertWith({
			status: 429,
			body: { error: { message: "Rate Limit Exceeded" } },
		});
		expect(result.outcome).toBe("rate-limited");
	});

	it("maps 401 to needs-reconnect", async () => {
		const result = await insertWith({
			status: 401,
			body: { error: { message: "Invalid Credentials" } },
		});
		expect(result.outcome).toBe("needs-reconnect");
	});

	it("marks a 5xx as retryable", async () => {
		const result = await insertWith({
			status: 503,
			body: { error: { message: "Backend Error" } },
		});
		expect(result).toEqual({
			outcome: "failed",
			reason: "Backend Error",
			retryable: true,
		});
	});

	it("fails on an unexpected success body", async () => {
		const result = await insertWith({ status: 200, body: { nope: true } });
		expect(result.outcome).toBe("failed");
	});

	it("reports a network error as retryable", async () => {
		const client = new CalendarWriteClient(tokens(), async () => {
			throw new Error("socket hang up");
		});
		expect(await client.insertEvent("user-1", booking)).toEqual({
			outcome: "failed",
			reason: "socket hang up",
			retryable: true,
		});
	});
});

describe("CalendarWriteClient.availableSlots", () => {
	it("reads free/busy for the search window and returns options", async () => {
		const { fetcher, calls } = fakeFetch([freeReply]);
		const client = new CalendarWriteClient(tokens(), fetcher);

		const result = await client.availableSlots("user-1", {
			now: new Date("2026-10-05T12:00:00Z"),
			timeZone: "America/New_York",
		});

		expect(result.outcome).toBe("ok");
		if (result.outcome !== "ok") return;
		expect(result.data).toHaveLength(3);
		expect(calls[0]?.body).toMatchObject({
			timeMin: "2026-10-05T12:00:00.000Z",
			timeMax: "2026-10-13T12:00:00.000Z",
		});
	});

	it("rejects an unknown time zone without calling Google", async () => {
		const { fetcher, calls } = fakeFetch([]);
		const client = new CalendarWriteClient(tokens(), fetcher);

		const result = await client.availableSlots("user-1", {
			now: new Date("2026-10-05T12:00:00Z"),
			timeZone: "Mars/Olympus",
		});

		expect(result.outcome).toBe("invalid-input");
		expect(calls).toHaveLength(0);
	});
});
