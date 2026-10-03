import { describe, expect, it } from "bun:test";
import {
	candidateSlots,
	generateSlots,
	slotSearchWindow,
	zonedTimeToUtc,
} from "../src/google/calendar-write.slots";

const NEW_YORK = "America/New_York";
const iso = (slots: { start: Date }[]) =>
	slots.map((slot) => slot.start.toISOString());

describe("generateSlots", () => {
	it("offers three options on different business days in the lead's zone", () => {
		const slots = generateSlots({
			now: new Date("2026-10-05T12:00:00Z"),
			timeZone: NEW_YORK,
			busy: [],
		});

		expect(iso(slots)).toEqual([
			"2026-10-05T14:00:00.000Z",
			"2026-10-06T13:00:00.000Z",
			"2026-10-07T13:00:00.000Z",
		]);
		expect(slots[0]?.end.toISOString()).toBe("2026-10-05T14:30:00.000Z");
		expect(slots.every((slot) => slot.timeZone === NEW_YORK)).toBe(true);
	});

	it("skips busy time from free/busy", () => {
		const slots = generateSlots({
			now: new Date("2026-10-05T12:00:00Z"),
			timeZone: NEW_YORK,
			busy: [
				{
					start: new Date("2026-10-05T14:00:00Z"),
					end: new Date("2026-10-05T16:00:00Z"),
				},
			],
		});

		expect(iso(slots)[0]).toBe("2026-10-05T16:00:00.000Z");
	});

	it("keeps a buffer around busy time", () => {
		const slots = generateSlots({
			now: new Date("2026-10-05T12:00:00Z"),
			timeZone: NEW_YORK,
			bufferMinutes: 15,
			busy: [
				{
					start: new Date("2026-10-05T14:00:00Z"),
					end: new Date("2026-10-05T16:00:00Z"),
				},
			],
		});

		expect(iso(slots)[0]).toBe("2026-10-05T16:30:00.000Z");
	});

	it("skips the weekend and a day that has no room after the lead time", () => {
		const slots = generateSlots({
			now: new Date("2026-10-09T20:00:00Z"),
			timeZone: NEW_YORK,
			busy: [],
		});

		expect(iso(slots)).toEqual([
			"2026-10-12T13:00:00.000Z",
			"2026-10-13T13:00:00.000Z",
			"2026-10-14T13:00:00.000Z",
		]);
	});

	it("follows the daylight saving change", () => {
		const slots = generateSlots({
			now: new Date("2026-10-30T20:00:00Z"),
			timeZone: NEW_YORK,
			busy: [],
		});

		expect(iso(slots)[0]).toBe("2026-11-02T14:00:00.000Z");
	});

	it("uses the business hours of the zone it is given", () => {
		const slots = generateSlots({
			now: new Date("2026-10-05T00:00:00Z"),
			timeZone: "Asia/Tokyo",
			busy: [],
			count: 2,
		});

		expect(iso(slots)).toEqual([
			"2026-10-05T02:00:00.000Z",
			"2026-10-06T00:00:00.000Z",
		]);
	});

	it("never returns fewer than two or more than three options when free", () => {
		const base = {
			now: new Date("2026-10-05T12:00:00Z"),
			timeZone: NEW_YORK,
			busy: [],
		};

		expect(generateSlots({ ...base, count: 1 })).toHaveLength(2);
		expect(generateSlots({ ...base, count: 9 })).toHaveLength(3);
	});

	it("fills from the same day when only one day is free", () => {
		const slots = generateSlots({
			now: new Date("2026-10-05T12:00:00Z"),
			timeZone: NEW_YORK,
			busy: [],
			horizonDays: 0,
		});

		expect(iso(slots)).toEqual([
			"2026-10-05T14:00:00.000Z",
			"2026-10-05T14:30:00.000Z",
			"2026-10-05T15:00:00.000Z",
		]);
	});

	it("returns nothing when the calendar is full", () => {
		const slots = generateSlots({
			now: new Date("2026-10-05T12:00:00Z"),
			timeZone: NEW_YORK,
			horizonDays: 2,
			busy: [
				{
					start: new Date("2026-10-05T00:00:00Z"),
					end: new Date("2026-10-09T00:00:00Z"),
				},
			],
		});

		expect(slots).toEqual([]);
	});

	it("rejects an unknown time zone", () => {
		expect(() =>
			candidateSlots({
				now: new Date("2026-10-05T12:00:00Z"),
				timeZone: "Mars/Olympus",
				busy: [],
			}),
		).toThrow(RangeError);
	});
});

describe("zonedTimeToUtc", () => {
	it("returns null for a wall time skipped by daylight saving", () => {
		expect(
			zonedTimeToUtc({ year: 2027, month: 3, day: 14 }, 150, NEW_YORK),
		).toBeNull();
	});

	it("converts a normal wall time", () => {
		expect(
			zonedTimeToUtc(
				{ year: 2026, month: 7, day: 1 },
				9 * 60,
				NEW_YORK,
			)?.toISOString(),
		).toBe("2026-07-01T13:00:00.000Z");
	});
});

describe("slotSearchWindow", () => {
	it("covers the horizon plus one day from now", () => {
		const window = slotSearchWindow({
			now: new Date("2026-10-05T12:00:00Z"),
			horizonDays: 7,
		});

		expect(window.end.toISOString()).toBe("2026-10-13T12:00:00.000Z");
	});
});
