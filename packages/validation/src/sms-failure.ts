export const SMS_FAILURE_REASONS = [
	"model-unavailable",
	"turn-failed",
	"plan-failed",
] as const;

export type SmsFailureReason = (typeof SMS_FAILURE_REASONS)[number];

export const SMS_FAILURE = {
	outcomePrefix: "failed",
	modelCallCodes: ["MODEL_CALL_FAILED"],
	messages: {
		"model-unavailable":
			"The assistant could not reply: model unavailable. Check the AI key.",
		"turn-failed":
			"The assistant could not reply: the turn failed. Read the reply and answer yourself.",
		"plan-failed":
			"The assistant could not reply: the task could not be planned. Read the reply and answer yourself.",
	},
} as const satisfies {
	outcomePrefix: string;
	modelCallCodes: readonly string[];
	messages: Record<SmsFailureReason, string>;
};

export function smsFailureOutcome(reason: SmsFailureReason): string {
	return `${SMS_FAILURE.outcomePrefix}: ${reason}`;
}

export function classifyTurnFailure(
	code: string | null | undefined,
): SmsFailureReason {
	const codes: readonly string[] = SMS_FAILURE.modelCallCodes;

	return code && codes.includes(code) ? "model-unavailable" : "turn-failed";
}

export function smsFailureReason(
	outcome: string | null | undefined,
): SmsFailureReason | null {
	const text = outcome?.trim();
	if (!text?.startsWith(SMS_FAILURE.outcomePrefix)) return null;

	const rest = text
		.slice(SMS_FAILURE.outcomePrefix.length)
		.replace(/^:\s*/, "");
	const typed = SMS_FAILURE_REASONS.find((reason) => reason === rest);
	if (typed) return typed;

	return rest.includes("planned") ? "plan-failed" : "turn-failed";
}

export function smsFailureMessage(
	outcome: string | null | undefined,
): string | null {
	const reason = smsFailureReason(outcome);

	return reason ? SMS_FAILURE.messages[reason] : null;
}
