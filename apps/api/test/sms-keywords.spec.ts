import { describe, expect, it } from "bun:test";
import { keywordOf, keywordReply } from "../src/sms/keywords";

describe("keywordOf", () => {
	it("recognises the opt-out set in any case and with punctuation", () => {
		for (const text of [
			"STOP",
			"stop",
			" Stop. ",
			"STOP!",
			"stopall",
			"Stop all",
			"unsubscribe",
			"cancel",
			"END",
			"quit",
			"opt out",
			"OPT-OUT",
			'"stop"',
		]) {
			expect(keywordOf(text)).toBe("stop");
		}
	});

	it("recognises START, UNSTOP, HELP and INFO", () => {
		expect(keywordOf("start")).toBe("start");
		expect(keywordOf("UNSTOP")).toBe("start");
		expect(keywordOf("Help?")).toBe("help");
		expect(keywordOf("info")).toBe("help");
	});

	it("leaves sentences to the agent's classifier", () => {
		for (const text of [
			"please stop texting me",
			"Don't stop, tell me more",
			"stopping by later",
			"I need help with my policy",
			"",
			"   ",
		]) {
			expect(keywordOf(text)).toBeNull();
		}
	});
});

describe("keywordReply", () => {
	it("names the workspace, or a fallback when it has no name", () => {
		expect(keywordReply("stop", "Acme Insurance")).toStartWith(
			"Acme Insurance: You are unsubscribed",
		);
		expect(keywordReply("help", null)).toStartWith("Our team:");
		expect(keywordReply("start", "  ")).toContain("Reply HELP for help");
	});
});
