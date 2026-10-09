import { describe, expect, it } from "bun:test";
import type { SmsSettings } from "@crm/validation/sms-settings";
import {
	autoSendChoice,
	brandProblem,
	firstMessagePreview,
	firstMessageProblem,
	frequencyCapText,
	parseStatesText,
	replyToneProblem,
	sameSmsSettings,
	statesProblem,
	statesText,
} from "./sms-settings-fields";

describe("parseStatesText", () => {
	it("splits on commas, spaces and semicolons and uppercases", () => {
		expect(parseStatesText("tx, fl;ny  ca")).toEqual(["TX", "FL", "NY", "CA"]);
	});

	it("reads an empty field as no limit", () => {
		expect(parseStatesText("  ")).toEqual([]);
	});

	it("round trips through statesText", () => {
		expect(parseStatesText(statesText(["TX", "FL"]))).toEqual(["TX", "FL"]);
	});
});

describe("statesProblem", () => {
	it("accepts an empty field and valid codes", () => {
		expect(statesProblem("")).toBeNull();
		expect(statesProblem("TX, FL")).toBeNull();
	});

	it("names a bad code and a repeated code", () => {
		expect(statesProblem("Texas")).toContain("two-letter");
		expect(statesProblem("TX, tx")).toContain("twice");
	});
});

describe("frequencyCapText", () => {
	it("states both limits", () => {
		expect(frequencyCapText({ perDay: 3, perWeek: 7 })).toBe(
			"A lead gets at most 3 texts a day and 7 a week while none of them gets an answer.",
		);
	});
});

const SETTINGS: SmsSettings = {
	firstMessageTemplate:
		"Hello {firstName}, this is {agency}. Reply STOP to opt out of texts.",
	disclosureMode: "disclose",
	autoSend: false,
	brandName: "",
	licensedStates: ["TX"],
	ambiguousMode: "human",
	replyTone: "",
};

describe("firstMessagePreview", () => {
	it("fills the name and the workspace name", () => {
		expect(firstMessagePreview(SETTINGS, "Acme")).toBe(
			"Hello Alex, this is Acme. Reply STOP to opt out of texts.",
		);
	});

	it("prefers the business name over the workspace name", () => {
		expect(
			firstMessagePreview(
				{ ...SETTINGS, brandName: "Sun Life Agency" },
				"Acme",
			),
		).toContain("this is Sun Life Agency.");
	});
});

describe("firstMessageProblem", () => {
	it("passes the default wording", () => {
		expect(firstMessageProblem(SETTINGS.firstMessageTemplate)).toBeNull();
	});

	it("does not require the business name", () => {
		expect(
			firstMessageProblem("Hello {firstName}, want a quote? Reply STOP."),
		).toBeNull();
	});
});

describe("replyToneProblem", () => {
	it("passes plain wording and an empty tone", () => {
		expect(replyToneProblem("")).toBeNull();
		expect(replyToneProblem("Warm and brief.")).toBeNull();
	});

	it("refuses a link", () => {
		expect(replyToneProblem("Send people to https://x.example")).not.toBeNull();
	});
});

describe("sameSmsSettings", () => {
	it("sees a changed toggle and ambiguous mode", () => {
		expect(sameSmsSettings(SETTINGS, { ...SETTINGS })).toBe(true);
		expect(sameSmsSettings(SETTINGS, { ...SETTINGS, replyTone: "Warm." })).toBe(
			false,
		);
		expect(
			sameSmsSettings(SETTINGS, { ...SETTINGS, ambiguousMode: "llm" }),
		).toBe(false);
	});
});

describe("choices and brand", () => {
	it("maps auto send to a choice", () => {
		expect(autoSendChoice(true)).toBe("auto");
		expect(autoSendChoice(false)).toBe("approve");
	});

	it("rejects a business name with a link", () => {
		expect(brandProblem("Acme")).toBeNull();
		expect(brandProblem("https://x.com")).toContain("link");
	});
});
