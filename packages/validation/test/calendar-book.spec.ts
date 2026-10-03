import { describe, expect, it } from "bun:test";
import {
	calendarBridgeRequest,
	parseCalendarBridgeResponse,
} from "../src/calendar-book";
import { parseCalendarSettings } from "../src/calendar-settings";

const BOOK = {
	action: "book",
	contactId: "c1",
	phone: "+15125550100",
	state: "TX",
	start: "2026-10-06T15:00:00.000Z",
	end: "2026-10-06T15:30:00.000Z",
	timeZone: "America/Chicago",
	summary: "Insurance call with Dana",
	description: "Booked by SMS.",
	attendee: { email: "dana@example.com", name: "Dana" },
	requestId: "book:c1:1",
	eventId: "abc123def",
} as const;

describe("calendarBridgeRequest", () => {
	it("reads both actions", () => {
		expect(
			calendarBridgeRequest.parse({
				action: "availableSlots",
				contactId: "c1",
				phone: "+15125550100",
				state: null,
			}).action,
		).toBe("availableSlots");
		expect(calendarBridgeRequest.parse(BOOK).action).toBe("book");
	});

	it("accepts a booking with no attendee", () => {
		expect(
			calendarBridgeRequest.safeParse({ ...BOOK, attendee: null }).success,
		).toBe(true);
	});

	it("refuses a meeting that ends before it starts", () => {
		expect(
			calendarBridgeRequest.safeParse({ ...BOOK, end: BOOK.start }).success,
		).toBe(false);
	});

	it("refuses an event id Google would reject", () => {
		expect(
			calendarBridgeRequest.safeParse({ ...BOOK, eventId: "Has_Upper" })
				.success,
		).toBe(false);
	});

	it("refuses a phone that is not E.164", () => {
		expect(
			calendarBridgeRequest.safeParse({ ...BOOK, phone: "512-555-0100" })
				.success,
		).toBe(false);
	});
});

describe("parseCalendarBridgeResponse", () => {
	it("reads a slot list", () => {
		const parsed = parseCalendarBridgeResponse({
			status: "slots",
			ownerUserId: "u1",
			timeZone: "America/Chicago",
			slots: [
				{ start: "2026-10-06T15:00:00.000Z", end: "2026-10-06T15:30:00.000Z" },
			],
		});
		expect(parsed.status).toBe("slots");
	});

	it("throws with the path on a bad body", () => {
		expect(() =>
			parseCalendarBridgeResponse({ status: "unavailable", reason: "nope" }),
		).toThrow(/reason/);
	});
});

describe("parseCalendarSettings", () => {
	it("defaults an empty column", () => {
		expect(parseCalendarSettings(null)).toEqual({
			ownerUserId: null,
			fallbackBookingLink: null,
		});
	});

	it("keeps stored keys and fills the rest", () => {
		expect(
			parseCalendarSettings({
				fallbackBookingLink: "https://example.com/book",
			}),
		).toEqual({
			ownerUserId: null,
			fallbackBookingLink: "https://example.com/book",
		});
	});

	it("refuses a link that is not http", () => {
		expect(() =>
			parseCalendarSettings({ fallbackBookingLink: "javascript:alert(1)" }),
		).toThrow(/fallbackBookingLink/);
	});
});
