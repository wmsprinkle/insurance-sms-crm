import { describe, expect, it } from "bun:test";
import { guardOutbound, OUTBOUND_GUARD } from "../src/outbound-guard";

const LINK = "https://cal.example.com/agency";

describe("guardOutbound", () => {
	it("passes a clean message unchanged", () => {
		expect(
			guardOutbound({
				message: "Does Tuesday at 2pm work for a quick call?",
				bookingLink: null,
				disclosure: "disclose",
			}),
		).toEqual({
			kind: "pass",
			message: "Does Tuesday at 2pm work for a quick call?",
		});
	});

	it("sanitizes emails, phone numbers and foreign links", () => {
		expect(
			guardOutbound({
				message: `Call 212-555-0123 or mail a@b.co, see www.x.com or ${LINK}`,
				bookingLink: LINK,
				disclosure: "disclose",
			}),
		).toEqual({ kind: "sanitized", message: `Call or mail , see or ${LINK}` });
	});

	it("caps the length by characters", () => {
		const verdict = guardOutbound({
			message: "😀".repeat(OUTBOUND_GUARD.maxChars + 5),
			bookingLink: null,
			disclosure: "disclose",
		});
		expect(verdict.kind).toBe("sanitized");
		expect(Array.from(verdict.message).length).toBe(OUTBOUND_GUARD.maxChars);
	});

	it("falls back when the text talks like a model", () => {
		expect(
			guardOutbound({
				message: "As an AI language model I cannot quote prices.",
				bookingLink: null,
				disclosure: "disclose",
			}),
		).toEqual({
			kind: "fallback",
			message: OUTBOUND_GUARD.safeFallback,
			reason: "breaks_character",
		});
	});

	it("allows an honest assistant disclosure only in disclose mode", () => {
		const message = "I'm an automated assistant for the agency.";
		expect(
			guardOutbound({ message, bookingLink: null, disclosure: "disclose" })
				.kind,
		).toBe("pass");
		expect(
			guardOutbound({ message, bookingLink: null, disclosure: "deflect" }).kind,
		).toBe("fallback");
	});

	it("falls back when sanitizing removes everything", () => {
		expect(
			guardOutbound({
				message: "212-555-0123",
				bookingLink: null,
				disclosure: "disclose",
			}),
		).toEqual({
			kind: "fallback",
			message: OUTBOUND_GUARD.safeFallback,
			reason: "empty_after_sanitize",
		});
	});

	it("reads the name Dan as a name, not a model", () => {
		expect(
			guardOutbound({
				message: "Dan from the agency here.",
				bookingLink: null,
				disclosure: "deflect",
			}).kind,
		).toBe("pass");
	});
});
