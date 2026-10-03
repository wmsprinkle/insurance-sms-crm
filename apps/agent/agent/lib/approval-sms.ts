import {
	SMS_HOLD_REASON_LABELS,
	type SmsHoldReason,
	type SmsSendPurpose,
} from "@crm/validation/sms-send";
import type { SmsSettings } from "@crm/validation/sms-settings";
import type { SendAttempt } from "./sms-outbound";

const FIXED_TEXT_PURPOSES = new Set<SmsSendPurpose>([
	"handoff",
	"opt-out-confirmation",
]);

export function holdBeforeSend(
	settings: Pick<SmsSettings, "autoSend">,
	purpose: SmsSendPurpose,
): SmsHoldReason | null {
	if (FIXED_TEXT_PURPOSES.has(purpose)) return null;
	return settings.autoSend ? null : "approval-mode";
}

export type AttemptVerdict =
	| { kind: "sent"; telnyxId: string; dryRun: boolean }
	| {
			kind: "hold";
			reason: SmsHoldReason;
			retryAt: Date | null;
			detail: string;
	  }
	| { kind: "refused"; reason: string };

export function judgeAttempt(attempt: SendAttempt): AttemptVerdict {
	switch (attempt.status) {
		case "sent":
			return {
				kind: "sent",
				telnyxId: attempt.telnyxId,
				dryRun: attempt.dryRun,
			};
		case "blocked":
			if (attempt.reason === "quiet-hours") {
				return {
					kind: "hold",
					reason: "quiet-hours",
					retryAt: attempt.retryAt ? new Date(attempt.retryAt) : null,
					detail: "The send gate blocked it for quiet hours.",
				};
			}
			return {
				kind: "refused",
				reason:
					attempt.reason === "suppressed"
						? "This number is suppressed. Send nothing more."
						: "This contact has no active SMS consent. Send nothing more.",
			};
		case "failed":
			return {
				kind: "hold",
				reason: "send-failed",
				retryAt: null,
				detail: attempt.error,
			};
		case "unavailable":
			return {
				kind: "hold",
				reason: "no-send-path",
				retryAt: null,
				detail: attempt.reason,
			};
	}
}

export function explainHold(
	reason: SmsHoldReason,
	retryAt: Date | null,
	detail: string | null,
): string {
	const when = retryAt ? ` It can go out from ${retryAt.toISOString()}.` : "";
	const why = detail ? ` ${detail}` : "";
	return `Held as a draft for a rep. ${SMS_HOLD_REASON_LABELS[reason]}${why}${when} Do not send it again.`;
}
