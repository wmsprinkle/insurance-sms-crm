import { describe, expect, it } from "bun:test";
import { toE164 } from "../src/phone";

describe("toE164", () => {
	it("reads a bare ten-digit number as North American", () => {
		expect(toE164("(555) 123-4567")).toBe("+15551234567");
		expect(toE164("555.123.4567")).toBe("+15551234567");
	});

	it("keeps an explicit country code", () => {
		expect(toE164("+1 555 123 4567")).toBe("+15551234567");
		expect(toE164("1-555-123-4567")).toBe("+15551234567");
		expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
		expect(toE164("0044 20 7946 0958")).toBe("+442079460958");
	});

	it("refuses what cannot be a phone number", () => {
		expect(toE164("")).toBeNull();
		expect(toE164("   ")).toBeNull();
		expect(toE164("12345")).toBeNull();
		expect(toE164("+0123456789")).toBeNull();
		expect(toE164("+1234567890123456")).toBeNull();
	});
});
