import { describe, expect, it } from "bun:test";
import type { DealStage } from "@crm/db/enums";
import type {
	CalendarBookRequest,
	CalendarBridgeRequest,
} from "@crm/validation/calendar-book";
import {
	type BookedMeeting,
	type BookingDeps,
	type BookingLead,
	bookingEventId,
	bookMeeting,
	confirmationText,
	proposeSlots,
	slotLabel,
} from "../agent/lib/sms-booking";
import {
	apiCalendarPath,
	type CalendarAttempt,
} from "../agent/lib/sms-calendar";
import { fakeSms, LEAD, recordingPath } from "./support/sms-fakes";

const NOW = new Date("2026-10-05T14:00:00.000Z");
const START = "2026-10-06T15:00:00.000Z";
const LATER = "2026-10-06T16:00:00.000Z";
const ZONE = "America/Chicago";
const SENT = { status: "sent", telnyxId: "tx-1", dryRun: true } as const;

const BOOKED: CalendarAttempt = {
	status: "booked",
	ownerUserId: "u-owner",
	timeZone: ZONE,
	organizerEmail: "agent@agency.test",
	eventId: "evt1",
	iCalUID: "evt1@google.com",
	htmlLink: null,
	meetUrl: "https://meet.google.com/abc",
	duplicate: false,
};

function harness(input: {
	lead?: Partial<BookingLead> | null;
	answers?: CalendarAttempt[];
	bookingLink?: string | null;
	typed?: string[];
}) {
	const sms = fakeSms({ autoSend: true });
	const path = recordingPath(SENT);
	const calls: CalendarBridgeRequest[] = [];
	const meetings: BookedMeeting[] = [];
	const emails: string[] = [];
	const stages: DealStage[] = [];
	const lead: BookingLead | null =
		input.lead === null
			? null
			: {
					id: LEAD.id,
					firstName: "Dana",
					lastName: "Reyes",
					email: null,
					phone: LEAD.phone,
					state: "TX",
					...input.lead,
				};
	const answers = [...(input.answers ?? [])];

	const deps: BookingDeps = {
		booking: {
			lead: async () => lead,
			saveEmail: async (_id, email) => {
				emails.push(email);
				return true;
			},
			leadTyped: async (_id, text) =>
				(input.typed ?? ["dana@example.com"]).includes(text),
			recordMeeting: async (meeting) => {
				meetings.push(meeting);
			},
			moveDeal: async (_id, stage) => {
				stages.push(stage);
				return { created: "d1", moved: [], skipped: null };
			},
		},
		calendar: async (request) => {
			calls.push(request);
			const next = answers.shift();
			if (!next) throw new Error("No scripted calendar answer left");
			return next;
		},
		delivery: { store: sms.store, sendPath: path.path, dryRun: true },
		bookingLink: input.bookingLink ?? null,
		taskId: "t-reply",
		now: NOW,
	};
	return { deps, calls, meetings, emails, stages, sends: path.calls };
}

function bookCall(calls: CalendarBridgeRequest[]): CalendarBookRequest {
	const call = calls.find((entry) => entry.action === "book");
	if (call?.action !== "book") throw new Error("No book call");
	return call;
}

describe("proposeSlots", () => {
	it("offers the free slots labelled in the lead's zone", async () => {
		const h = harness({
			answers: [
				{
					status: "slots",
					ownerUserId: "u-owner",
					timeZone: ZONE,
					slots: [
						{ start: START, end: "2026-10-06T15:30:00.000Z" },
						{ start: LATER, end: "2026-10-06T16:30:00.000Z" },
					],
				},
			],
		});

		const result = await proposeSlots(LEAD.id, h.deps);

		expect(result.status).toBe("slots");
		if (result.status !== "slots") return;
		expect(result.slots).toEqual([
			{
				start: START,
				label: expect.stringMatching(/^Tue, Oct 6.* 10:00 AM CDT$/),
			},
			{
				start: LATER,
				label: expect.stringMatching(/^Tue, Oct 6.* 11:00 AM CDT$/),
			},
		]);
		expect(h.calls[0]).toEqual({
			action: "availableSlots",
			contactId: LEAD.id,
			phone: LEAD.phone,
			state: "TX",
		});
		expect(h.sends).toHaveLength(0);
	});

	it("points at the fallback booking link when the calendar is unavailable", async () => {
		const h = harness({
			answers: [
				{
					status: "unavailable",
					reason: "needs-reconsent",
					detail: "no grant",
					retryable: false,
				},
			],
			bookingLink: "https://book.example.com/agency",
		});

		const result = await proposeSlots(LEAD.id, h.deps);

		expect(result).toMatchObject({ status: "unavailable" });
		if (result.status !== "unavailable") return;
		expect(result.next).toContain("https://book.example.com/agency");
	});

	it("hands off when there is no calendar and no link", async () => {
		const h = harness({
			answers: [{ status: "no-bridge", reason: "API_URL is not set." }],
		});

		const result = await proposeSlots(LEAD.id, h.deps);

		expect(result.status === "unavailable" && result.next).toContain(
			"handoff_to_human",
		);
	});
});

describe("bookMeeting", () => {
	it("asks for an email before booking", async () => {
		const h = harness({});

		const result = await bookMeeting(LEAD.id, { start: START }, h.deps);

		expect(result.status).toBe("needs-email");
		expect(h.calls).toHaveLength(0);
	});

	it("refuses a malformed email without booking", async () => {
		const h = harness({});

		const result = await bookMeeting(
			LEAD.id,
			{ start: START, email: "dana at example" },
			h.deps,
		);

		expect(result.status).toBe("needs-email");
		expect(h.calls).toHaveLength(0);
	});

	it("refuses a start in the past", async () => {
		const h = harness({});

		const result = await bookMeeting(
			LEAD.id,
			{ start: "2026-10-01T15:00:00.000Z", email: "dana@example.com" },
			h.deps,
		);

		expect(result.status).toBe("refused");
	});

	it("refuses to invite an email the lead never typed and is not on record", async () => {
		const h = harness({ answers: [BOOKED], typed: [] });

		const result = await bookMeeting(
			LEAD.id,
			{ start: START, email: "boss@thirdparty.example" },
			h.deps,
		);

		expect(result.status).toBe("needs-email");
		expect(h.calls).toHaveLength(0);
		expect(h.emails).toHaveLength(0);
	});

	it("invites the email already on the record without a typed copy", async () => {
		const h = harness({
			answers: [BOOKED],
			typed: [],
			lead: { email: "dana@example.com" },
		});

		const result = await bookMeeting(
			LEAD.id,
			{ start: START, email: "dana@example.com" },
			h.deps,
		);

		expect(result.status).toBe("booked");
		expect(bookCall(h.calls).attendee?.email).toBe("dana@example.com");
	});

	it("keeps the lead's phone out of the calendar event", async () => {
		const h = harness({ answers: [BOOKED] });

		await bookMeeting(
			LEAD.id,
			{ start: START, email: "dana@example.com" },
			h.deps,
		);

		expect(bookCall(h.calls).description).not.toContain(LEAD.phone);
	});

	it("books with the invite, records it, moves the deal and confirms by SMS", async () => {
		const h = harness({ answers: [BOOKED] });

		const result = await bookMeeting(
			LEAD.id,
			{ start: START, email: "Dana@Example.com" },
			h.deps,
		);

		expect(result).toMatchObject({
			status: "booked",
			when: expect.stringMatching(/^Tue, Oct 6.* 10:00 AM CDT$/),
			invited: true,
			dealCreated: true,
			confirmation: "sent",
		});
		const call = bookCall(h.calls);
		expect(call).toMatchObject({
			start: START,
			end: "2026-10-06T15:30:00.000Z",
			attendee: { email: "dana@example.com", name: "Dana Reyes" },
			eventId: bookingEventId(LEAD.id, new Date(START)),
		});
		expect(call.eventId).toMatch(/^[a-v0-9]{5,1024}$/);
		expect(h.emails).toEqual(["dana@example.com"]);
		expect(h.meetings[0]).toMatchObject({
			contactId: LEAD.id,
			ownerUserId: "u-owner",
			iCalUID: "evt1@google.com",
			meetUrl: "https://meet.google.com/abc",
		});
		expect(h.stages).toEqual(["DEMO_BOOKED"]);
		expect(h.sends).toHaveLength(1);
		expect(h.sends[0]).toMatchObject({
			purpose: "conversation",
			idempotencyKey: `book_meeting:${call.eventId}`,
		});
		expect(h.sends[0]?.text).toContain("calendar invite");
	});

	it("uses the email already on the contact", async () => {
		const h = harness({
			lead: { email: "dana@example.com" },
			answers: [BOOKED],
		});

		await bookMeeting(LEAD.id, { start: START }, h.deps);

		expect(bookCall(h.calls).attendee?.email).toBe("dana@example.com");
		expect(h.emails).toHaveLength(0);
	});

	it("books on our calendar only when the lead declines an email", async () => {
		const h = harness({ answers: [BOOKED] });

		const result = await bookMeeting(
			LEAD.id,
			{ start: START, emailDeclined: true },
			h.deps,
		);

		expect(result).toMatchObject({ status: "booked", invited: false });
		expect(bookCall(h.calls).attendee).toBeNull();
		expect(h.sends[0]?.text).toContain("call you at this number");
	});

	it("offers new slots when the time was taken", async () => {
		const h = harness({
			answers: [
				{
					status: "slot-taken",
					timeZone: ZONE,
					slots: [{ start: LATER, end: "2026-10-06T16:30:00.000Z" }],
				},
			],
		});

		const result = await bookMeeting(
			LEAD.id,
			{ start: START, email: "dana@example.com" },
			h.deps,
		);

		expect(result).toMatchObject({
			status: "slot-taken",
			slots: [
				{
					start: LATER,
					label: expect.stringMatching(/^Tue, Oct 6.* 11:00 AM CDT$/),
				},
			],
		});
		expect(h.meetings).toHaveLength(0);
		expect(h.stages).toHaveLength(0);
		expect(h.sends).toHaveLength(0);
	});

	it("records nothing when the calendar refuses", async () => {
		const h = harness({
			answers: [
				{
					status: "unavailable",
					reason: "invalid-input",
					detail: "outside business hours",
					retryable: false,
				},
			],
		});

		const result = await bookMeeting(
			LEAD.id,
			{ start: START, email: "dana@example.com" },
			h.deps,
		);

		expect(result.status).toBe("unavailable");
		expect(h.meetings).toHaveLength(0);
		expect(h.sends).toHaveLength(0);
	});
});

describe("confirmationText", () => {
	it("keeps the confirmation free of contact details the guard strips", () => {
		const text = confirmationText(slotLabel(new Date(START), ZONE), true);
		expect(text).not.toMatch(/@|https?:/);
		expect(text.length).toBeLessThanOrEqual(480);
	});
});

describe("apiCalendarPath", () => {
	const REQUEST: CalendarBridgeRequest = {
		action: "availableSlots",
		contactId: LEAD.id,
		phone: LEAD.phone,
		state: null,
	};

	it("reports no bridge without API_URL or the secret", async () => {
		const path = apiCalendarPath({}, async () => {
			throw new Error("must not fetch");
		});

		expect((await path(REQUEST)).status).toBe("no-bridge");
	});

	it("posts the bearer secret to the calendar path", async () => {
		const seen: { url: string; auth: string | null; body: string }[] = [];
		const path = apiCalendarPath(
			{ API_URL: "http://api.test", AGENT_BRIDGE_SECRET: "s3cret" },
			async (url, init) => {
				seen.push({
					url: String(url),
					auth: new Headers(init?.headers).get("authorization"),
					body: String(init?.body),
				});
				return Response.json({
					status: "slots",
					ownerUserId: "u1",
					timeZone: ZONE,
					slots: [],
				});
			},
		);

		expect((await path(REQUEST)).status).toBe("slots");
		expect(seen[0]?.url).toBe("http://api.test/internal/calendar/book");
		expect(seen[0]?.auth).toBe("Bearer s3cret");
		expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual(REQUEST);
	});

	it("reports no bridge on a non-2xx answer", async () => {
		const path = apiCalendarPath(
			{ API_URL: "http://api.test", AGENT_BRIDGE_SECRET: "s3cret" },
			async () => new Response("nope", { status: 503 }),
		);

		expect(await path(REQUEST)).toMatchObject({ status: "no-bridge" });
	});

	it("throws on an unreadable 2xx body", async () => {
		const path = apiCalendarPath(
			{ API_URL: "http://api.test", AGENT_BRIDGE_SECRET: "s3cret" },
			async () => Response.json({ status: "weird" }),
		);

		await expect(path(REQUEST)).rejects.toThrow(/calendar bridge response/);
	});
});
