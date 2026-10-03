import { describe, expect, it } from "bun:test";
import { keywordOf, keywordReply, optOutIntentOf } from "../src/sms/keywords";

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

describe("R2: optOutIntentOf wide phrase detection", () => {
	it("suppresses the phrasings the re-review found", () => {
		for (const text of [
			"please stop",
			"Please STOP.",
			"pls dont txt me",
			"dont TXT me",
			"don\u2019t TXT me!!",
			"unsub",
			"I want you to stop",
			"please do not send me any more",
			"I'm not interested please stop",
			"text STOP to end",
			"S T O P",
			"s.t.o.p",
			"S-T-O-P",
			"\u0455top",
			"\uff33\uff34\uff2f\uff30",
			"stoooop",
			"st\u200bop",
			"cease and desist",
			"stahp",
		]) {
			expect(optOutIntentOf(text)).toBe("opt_out");
		}
	});

	it("keeps ordinary and benign stop sentences out", () => {
		for (const text of [
			"Stop by at 5",
			"stop in tomorrow?",
			"don't stop calling about the quote, I am busy",
			"no",
			"enough coverage for a family of four?",
			"stopped by your office last week",
			"The bus stop is near my house and I want a quote today please",
		]) {
			expect(optOutIntentOf(text)).toBeNull();
		}
	});

	it("fails safe: a short ambiguous stop sentence is suppressed", () => {
		expect(optOutIntentOf("How do I stop my renewal")).toBe("opt_out");
	});

	it("does not look for a stop word in a long message", () => {
		const long = `${"I would like a quote for my family please call me. ".repeat(2)}stop`;
		expect(optOutIntentOf(long)).toBeNull();
	});
});
