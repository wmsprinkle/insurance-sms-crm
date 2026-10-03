import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import type {
	CalendarBookRequest,
	CalendarBridgeRequest,
} from "@crm/validation/calendar-book";
import type { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../src/config/env.validation";
import {
	leadTimeZone,
	unavailable,
	withinBusinessHours,
} from "../src/google/calendar-internal";
import { CalendarInternalController } from "../src/google/calendar-internal.controller";
import { CalendarInternalService } from "../src/google/calendar-internal.service";
import type { CalendarWriteClient } from "../src/google/calendar-write.client";
import type {
	BookingInput,
	CalendarWriteResult,
} from "../src/google/calendar-write.contracts";
import type { Slot } from "../src/google/calendar-write.slots";
import { requestWith } from "./support/sms-fakes";

const SECRET = "bridge-secret";
const NOW = new Date("2026-10-05T14:00:00.000Z");

const SLOT: Slot = {
	start: new Date("2026-10-06T15:00:00.000Z"),
	end: new Date("2026-10-06T15:30:00.000Z"),
	timeZone: "America/Chicago",
};

const BOOK: CalendarBookRequest = {
	action: "book",
	contactId: "c1",
	phone: "+15125550100",
	state: null,
	start: SLOT.start.toISOString(),
	end: SLOT.end.toISOString(),
	summary: "Insurance call with Dana",
	description: "Booked by SMS.",
	attendee: { email: "dana@example.com", name: "Dana" },
	requestId: "book:c1",
	eventId: "abc123def",
};

type Seed = {
	calendar?: unknown;
	accounts?: { userId: string; providerId: string }[];
};

function fakeDb(seed: Seed) {
	return {
		appSetting: {
			findUnique: async () =>
				seed.calendar === undefined ? null : { calendar: seed.calendar },
		},
		account: {
			findFirst: async ({ where }: { where: { providerId: string } }) =>
				seed.accounts?.find(
					(account) => account.providerId === where.providerId,
				) ?? null,
		},
		user: {
			findUnique: async ({ where }: { where: { id: string } }) => ({
				email: `${where.id}@agency.test`,
			}),
		},
	} as unknown as Db;
}

type Scripted = {
	slots: CalendarWriteResult<Slot[]>[];
	books: CalendarWriteResult<{
		eventId: string;
		htmlLink: string | null;
		meetUrl: string | null;
		iCalUID: string | null;
		conferenceStatus: string | null;
	}>[];
};

function fakeCalendar(script: Scripted) {
	const calls = {
		slots: [] as { userId: string; timeZone: string; now: Date }[],
		books: [] as { userId: string; input: BookingInput }[],
	};
	const writer = {
		availableSlots: async (
			userId: string,
			options: { timeZone: string; now: Date },
		) => {
			calls.slots.push({ userId, ...options });
			const next = script.slots.shift();
			if (!next) throw new Error("No scripted slots left");
			return next;
		},
		bookSlot: async (userId: string, input: BookingInput) => {
			calls.books.push({ userId, input });
			const next = script.books.shift();
			if (!next) throw new Error("No scripted booking left");
			return next;
		},
	} as unknown as CalendarWriteClient;
	return { calls, writer };
}

function service(seed: Seed, script: Scripted) {
	const calendar = fakeCalendar(script);
	return {
		calls: calendar.calls,
		service: new CalendarInternalService(
			fakeDb(seed),
			calendar.writer,
			() => NOW,
		),
	};
}

const GOOGLE = [{ userId: "u-first", providerId: "google" }];

describe("leadTimeZone", () => {
	it("uses the declared state before the area code", () => {
		expect(leadTimeZone("+15125550100", "CA")).toBe("America/Los_Angeles");
		expect(leadTimeZone("+15125550100", null)).toBe("America/Chicago");
	});

	it("falls back to a US zone for an unknown number", () => {
		expect(leadTimeZone("+15555550100", null)).toMatch(/^America\//);
	});
});

describe("withinBusinessHours", () => {
	it("accepts a weekday slot and refuses evenings and weekends", () => {
		expect(withinBusinessHours(SLOT.start, SLOT.end, "America/Chicago")).toBe(
			true,
		);
		expect(
			withinBusinessHours(
				new Date("2026-10-06T23:00:00.000Z"),
				new Date("2026-10-06T23:30:00.000Z"),
				"America/Chicago",
			),
		).toBe(false);
		expect(
			withinBusinessHours(
				new Date("2026-10-10T15:00:00.000Z"),
				new Date("2026-10-10T15:30:00.000Z"),
				"America/Chicago",
			),
		).toBe(false);
	});
});

describe("unavailable", () => {
	it("marks only transient failures retryable", () => {
		expect(
			unavailable({ outcome: "rate-limited", reason: "x", retryAfterMs: 1 }),
		).toMatchObject({ reason: "rate-limited", retryable: true });
		expect(
			unavailable({
				outcome: "needs-reconsent",
				reason: "x",
				missingScopes: [],
			}),
		).toMatchObject({ reason: "needs-reconsent", retryable: false });
	});
});

describe("CalendarInternalService", () => {
	const SLOTS_REQUEST: CalendarBridgeRequest = {
		action: "availableSlots",
		contactId: "c1",
		phone: "+15125550100",
		state: null,
	};

	it("answers no-owner without a setting or a Google account", async () => {
		const { service: api, calls } = service({}, { slots: [], books: [] });

		expect(await api.handle(SLOTS_REQUEST)).toMatchObject({
			status: "unavailable",
			reason: "no-owner",
		});
		expect(calls.slots).toHaveLength(0);
	});

	it("defaults the owner to the first connected Google user", async () => {
		const { service: api, calls } = service(
			{ accounts: GOOGLE },
			{ slots: [{ outcome: "ok", data: [SLOT] }], books: [] },
		);

		expect(await api.handle(SLOTS_REQUEST)).toEqual({
			status: "slots",
			ownerUserId: "u-first",
			timeZone: "America/Chicago",
			slots: [{ start: SLOT.start.toISOString(), end: SLOT.end.toISOString() }],
		});
		expect(calls.slots[0]).toEqual({
			userId: "u-first",
			timeZone: "America/Chicago",
			now: NOW,
		});
	});

	it("prefers calendar.ownerUserId from settings", async () => {
		const { service: api } = service(
			{ accounts: GOOGLE, calendar: { ownerUserId: "u-chosen" } },
			{ slots: [], books: [] },
		);

		expect(await api.ownerUserId()).toBe("u-chosen");
	});

	it("books with the lead as the only attendee", async () => {
		const { service: api, calls } = service(
			{ accounts: GOOGLE },
			{
				slots: [],
				books: [
					{
						outcome: "ok",
						data: {
							eventId: "abc123def",
							htmlLink: "https://calendar.google.com/e",
							meetUrl: "https://meet.google.com/x",
							iCalUID: "abc123def@google.com",
							conferenceStatus: "success",
						},
					},
				],
			},
		);

		expect(await api.handle(BOOK)).toEqual({
			status: "booked",
			ownerUserId: "u-first",
			timeZone: "America/Chicago",
			organizerEmail: "u-first@agency.test",
			eventId: "abc123def",
			iCalUID: "abc123def@google.com",
			htmlLink: "https://calendar.google.com/e",
			meetUrl: "https://meet.google.com/x",
			duplicate: false,
		});
		expect(calls.books[0]?.input).toMatchObject({
			start: SLOT.start,
			end: SLOT.end,
			attendees: [{ email: "dana@example.com", displayName: "Dana" }],
			eventId: "abc123def",
		});
	});

	it("books on the owner's calendar only when the lead gave no email", async () => {
		const { service: api, calls } = service(
			{ accounts: GOOGLE },
			{
				slots: [],
				books: [
					{
						outcome: "ok",
						data: {
							eventId: "abc123def",
							htmlLink: null,
							meetUrl: null,
							iCalUID: null,
							conferenceStatus: null,
						},
					},
				],
			},
		);

		await api.handle({ ...BOOK, attendee: null });
		expect(calls.books[0]?.input.attendees).toEqual([]);
	});

	it("refuses a time outside business hours in the lead's zone", async () => {
		const { service: api, calls } = service(
			{ accounts: GOOGLE },
			{ slots: [], books: [] },
		);

		expect(
			await api.handle({
				...BOOK,
				start: "2026-10-06T03:00:00.000Z",
				end: "2026-10-06T03:30:00.000Z",
			}),
		).toMatchObject({ status: "unavailable", reason: "invalid-input" });
		expect(calls.books).toHaveLength(0);
	});

	it("treats a repeated event id as already booked", async () => {
		const { service: api } = service(
			{ accounts: GOOGLE },
			{ slots: [], books: [{ outcome: "duplicate", reason: "409" }] },
		);

		expect(await api.handle(BOOK)).toMatchObject({
			status: "booked",
			eventId: "abc123def",
			duplicate: true,
		});
	});

	it("offers fresh slots when the slot was taken", async () => {
		const later: Slot = {
			...SLOT,
			start: new Date("2026-10-06T16:00:00.000Z"),
			end: new Date("2026-10-06T16:30:00.000Z"),
		};
		const { service: api } = service(
			{ accounts: GOOGLE },
			{
				slots: [{ outcome: "ok", data: [later] }],
				books: [{ outcome: "slot-taken", reason: "busy", busy: [] }],
			},
		);

		expect(await api.handle(BOOK)).toEqual({
			status: "slot-taken",
			timeZone: "America/Chicago",
			slots: [
				{ start: later.start.toISOString(), end: later.end.toISOString() },
			],
		});
	});

	it("passes a missing grant through as needs-reconsent", async () => {
		const { service: api } = service(
			{ accounts: GOOGLE },
			{
				slots: [],
				books: [
					{
						outcome: "needs-reconsent",
						reason: "no grant",
						missingScopes: ["x"],
					},
				],
			},
		);

		expect(await api.handle(BOOK)).toMatchObject({
			status: "unavailable",
			reason: "needs-reconsent",
		});
	});
});

describe("CalendarInternalController", () => {
	function controller(secret: string | undefined) {
		const received: CalendarBridgeRequest[] = [];
		const calendar = {
			handle: async (body: CalendarBridgeRequest) => {
				received.push(body);
				return {
					status: "slots",
					ownerUserId: "u1",
					timeZone: "America/Chicago",
					slots: [],
				};
			},
		} as unknown as CalendarInternalService;
		const config = {
			get: () => secret,
		} as unknown as ConfigService<EnvironmentVariables, true>;
		return {
			received,
			api: new CalendarInternalController(calendar, config),
		};
	}

	const body = JSON.stringify(BOOK);

	it("answers 503 when the bridge secret is not set", async () => {
		const { api } = controller(undefined);

		await expect(
			api.book(requestWith(body), `Bearer ${SECRET}`),
		).rejects.toMatchObject({ status: 503 });
	});

	it("answers 401 for a wrong bearer and reads no body", async () => {
		const { api, received } = controller(SECRET);

		await expect(
			api.book(requestWith(body), "Bearer wrong"),
		).rejects.toMatchObject({ status: 401 });
		expect(received).toHaveLength(0);
	});

	it("answers 400 for a body that breaks the contract", async () => {
		const { api } = controller(SECRET);

		await expect(
			api.book(
				requestWith(JSON.stringify({ ...BOOK, phone: "nope" })),
				`Bearer ${SECRET}`,
			),
		).rejects.toMatchObject({ status: 400 });
		await expect(
			api.book(requestWith("{not json"), `Bearer ${SECRET}`),
		).rejects.toMatchObject({ status: 400 });
	});

	it("answers 413 for a body over the cap", async () => {
		const { api } = controller(SECRET);

		await expect(
			api.book(requestWith("x".repeat(40 * 1024)), `Bearer ${SECRET}`),
		).rejects.toMatchObject({ status: 413 });
	});

	it("hands a valid body to the service", async () => {
		const { api, received } = controller(SECRET);

		expect(await api.book(requestWith(body), `Bearer ${SECRET}`)).toMatchObject(
			{ status: "slots" },
		);
		expect(received[0]).toMatchObject({ action: "book", contactId: "c1" });
	});
});
