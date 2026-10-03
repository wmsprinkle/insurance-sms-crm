import { describe, expect, it } from "bun:test";
import { calendarSettings } from "@crm/validation/calendar-settings";
import { CALENDAR_OWNER_AUTO, ownerOptionValue } from "./calendar-settings";

describe("ownerOptionValue", () => {
	it("shows no chosen owner as the automatic option", () => {
		expect(ownerOptionValue(null)).toBe(CALENDAR_OWNER_AUTO);
	});

	it("shows a chosen owner by user id", () => {
		expect(ownerOptionValue("u1")).toBe("u1");
	});
});

describe("fallback booking link", () => {
	it("accepts an https link and an empty value", () => {
		expect(
			calendarSettings.safeParse({
				ownerUserId: null,
				fallbackBookingLink: "https://cal.example.com/a",
			}).success,
		).toBe(true);
		expect(
			calendarSettings.safeParse({
				ownerUserId: null,
				fallbackBookingLink: null,
			}).success,
		).toBe(true);
	});

	it("rejects text that is not an http link", () => {
		for (const bad of [
			"cal.example.com",
			"javascript:alert(1)",
			"ftp://x.io",
		]) {
			expect(
				calendarSettings.safeParse({
					ownerUserId: null,
					fallbackBookingLink: bad,
				}).success,
			).toBe(false);
		}
	});
});
