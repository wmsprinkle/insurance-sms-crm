import { describe, expect, it } from "bun:test";
import {
	classifyTurnFailure,
	SMS_FAILURE,
	smsFailureMessage,
	smsFailureOutcome,
	smsFailureReason,
} from "../src/sms-failure";

describe("classifyTurnFailure", () => {
	it("names a model call failure as model unavailable", () => {
		expect(classifyTurnFailure("MODEL_CALL_FAILED")).toBe("model-unavailable");
	});

	it("names anything else, or nothing, as a failed turn", () => {
		expect(classifyTurnFailure("TOOL_ERROR")).toBe("turn-failed");
		expect(classifyTurnFailure(null)).toBe("turn-failed");
		expect(classifyTurnFailure(undefined)).toBe("turn-failed");
	});
});

describe("smsFailureOutcome and smsFailureReason", () => {
	it("round trips every reason", () => {
		for (const reason of [
			"model-unavailable",
			"turn-failed",
			"plan-failed",
		] as const) {
			expect(smsFailureReason(smsFailureOutcome(reason))).toBe(reason);
		}
	});

	it("reads the outcomes written before reasons were typed", () => {
		expect(smsFailureReason("failed")).toBe("turn-failed");
		expect(smsFailureReason("failed: the task could not be planned")).toBe(
			"plan-failed",
		);
	});

	it("is null for an outcome that is not a failure", () => {
		for (const outcome of ["replied", "not-interested", "", null, undefined]) {
			expect(smsFailureReason(outcome)).toBeNull();
		}
	});
});

describe("smsFailureMessage", () => {
	it("tells the person to check the AI key when the model is unavailable", () => {
		expect(smsFailureMessage(smsFailureOutcome("model-unavailable"))).toBe(
			"The assistant could not reply: model unavailable. Check the AI key.",
		);
	});

	it("has a message for each reason", () => {
		for (const message of Object.values(SMS_FAILURE.messages)) {
			expect(message.startsWith("The assistant could not reply")).toBe(true);
		}
	});
});
