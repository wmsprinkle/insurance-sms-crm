import { describe, expect, it } from "bun:test";
import {
	frequencyCapText,
	parseStatesText,
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
