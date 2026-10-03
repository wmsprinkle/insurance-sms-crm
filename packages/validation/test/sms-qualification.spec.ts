import { describe, expect, it } from "bun:test";
import {
	judgeQualification,
	qualificationFacts,
	SMS_DEAL_STAGE,
	SMS_NEXT_ACTION,
	SMS_REPLY_CLASSES,
	strongestClass,
} from "../src/sms-qualification";

const COMPLETE = {
	line: "term_life",
	state: "TX",
	ageBand: "30-39",
	timeline: "30_days",
} as const;

describe("reply classes", () => {
	it("are in skill precedence order", () => {
		expect([...SMS_REPLY_CLASSES]).toEqual([
			"opt_out",
			"wrong_number",
			"needs_human",
			"not_interested",
			"qualified",
			"interested",
			"question",
		]);
	});

	it("opt_out beats everything", () => {
		expect(strongestClass(["question", "interested", "opt_out"])).toBe(
			"opt_out",
		);
		expect(strongestClass(["interested", "not_interested"])).toBe(
			"not_interested",
		);
	});

	it("map every class to a next action and a stage", () => {
		for (const value of SMS_REPLY_CLASSES) {
			expect(SMS_NEXT_ACTION[value].length).toBeGreaterThan(0);
			expect(value in SMS_DEAL_STAGE).toBe(true);
		}
		expect(SMS_DEAL_STAGE.qualified).toBe("QUALIFIED_TO_BUY");
		expect(SMS_DEAL_STAGE.not_interested).toBe("UNQUALIFIED_TO_BUY");
		expect(SMS_DEAL_STAGE.needs_human).toBeNull();
	});
});

describe("qualificationFacts", () => {
	it("upper-cases the state and refuses a bad code", () => {
		expect(qualificationFacts.parse({ state: "tx" }).state).toBe("TX");
		expect(qualificationFacts.safeParse({ state: "Texas" }).success).toBe(
			false,
		);
	});

	it("refuses an age band that is not on the list", () => {
		expect(qualificationFacts.safeParse({ ageBand: "17" }).success).toBe(false);
	});
});

describe("judgeQualification", () => {
	it("qualifies when every required fact is known", () => {
		expect(judgeQualification(COMPLETE, [])).toEqual({ status: "qualified" });
	});

	it("does not need coverage", () => {
		expect(judgeQualification(COMPLETE, []).status).toBe("qualified");
	});

	it("lists what is missing", () => {
		expect(judgeQualification({ line: "term_life" }, [])).toEqual({
			status: "incomplete",
			missing: ["state", "ageBand", "timeline"],
		});
	});

	it("rejects an unlicensed state", () => {
		expect(judgeQualification(COMPLETE, ["FL", "GA"]).status).toBe(
			"disqualified",
		);
	});

	it("does not reject on state when no states are set", () => {
		expect(judgeQualification({ ...COMPLETE, state: "AK" }, []).status).toBe(
			"qualified",
		);
	});

	it("rejects a lead under 18", () => {
		expect(judgeQualification(COMPLETE, [], { underAge: true })).toEqual({
			status: "disqualified",
			reason: "The lead is under 18.",
		});
	});
});
