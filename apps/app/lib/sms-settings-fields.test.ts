import { describe, expect, it } from "bun:test";
import type { SmsSettings } from "@crm/validation/sms-settings";
import {
	autoSendChoice,
	brandProblem,
	firstMessagePreview,
	frequencyCapText,
	parseStatesText,
	sameSmsSettings,
	showFirstMessageWarning,
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
	firstMessageTemplate: "Hello {firstName}, reply STOP to opt out of texts.",
	disclosureMode: "disclose",
	autoSend: false,
	brandName: "",
	licensedStates: ["TX"],
	firstMessageBrandPrefix: false,
	firstMessageStopFooter: false,
	ambiguousMode: "human",
};

describe("firstMessagePreview", () => {
	it("shows the plain message by default", () => {
		expect(firstMessagePreview(SETTINGS, "Acme")).toBe(
			"Hello Alex, Are you interested in life or health coverage?",
		);
	});

	it("adds the business name and the STOP footer", () => {
		expect(
			firstMessagePreview(
				{
					...SETTINGS,
					firstMessageBrandPrefix: true,
					firstMessageStopFooter: true,
				},
				"Acme",
			),
		).toBe(
			"Acme: Hello Alex, Are you interested in life or health coverage? Reply STOP to opt out.",
		);
	});

	it("prefers the business name over the workspace name", () => {
		expect(
			firstMessagePreview(
				{
					...SETTINGS,
					brandName: "Sun Life Agency",
					firstMessageBrandPrefix: true,
				},
				"Acme",
			),
		).toContain("Sun Life Agency:");
	});
});

describe("showFirstMessageWarning", () => {
	it("shows when either toggle is off", () => {
		expect(showFirstMessageWarning(SETTINGS)).toBe(true);
		expect(
			showFirstMessageWarning({
				...SETTINGS,
				firstMessageBrandPrefix: true,
			}),
		).toBe(true);
	});

	it("hides when both toggles are on", () => {
		expect(
			showFirstMessageWarning({
				...SETTINGS,
				firstMessageBrandPrefix: true,
				firstMessageStopFooter: true,
			}),
		).toBe(false);
	});
});

describe("sameSmsSettings", () => {
	it("sees a changed toggle and ambiguous mode", () => {
		expect(sameSmsSettings(SETTINGS, { ...SETTINGS })).toBe(true);
		expect(
			sameSmsSettings(SETTINGS, { ...SETTINGS, firstMessageStopFooter: true }),
		).toBe(false);
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
