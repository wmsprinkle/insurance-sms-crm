import { guardOutbound } from "@crm/validation/outbound-guard";
import {
	SMS_HOLD_REASON_LABELS,
	SMS_HOLD_REASONS,
	type SmsSendResponse,
} from "@crm/validation/sms-send";
import type { SmsDisclosureMode } from "@crm/validation/sms-settings";
import { z } from "zod";
import type { SmsSendOutcome } from "./drafts.contracts";
import { SMS_INTERNAL } from "./sms-internal";

const holdReason = z.enum(SMS_HOLD_REASONS);

export function holdReasonLabel(reason: string): string {
	const parsed = holdReason.safeParse(reason);
	return parsed.success ? SMS_HOLD_REASON_LABELS[parsed.data] : reason;
}

export type GuardedText =
	| { ok: true; text: string }
	| { ok: false; outcome: SmsSendOutcome };

export function guardRepText(
	text: string,
	disclosure: SmsDisclosureMode,
): GuardedText {
	const verdict = guardOutbound({
		message: text,
		bookingLink: null,
		disclosure,
	});
	if (verdict.kind === "pass") return { ok: true, text: verdict.message };
	return {
		ok: false,
		outcome: {
			status: "guarded",
			reason: verdict.kind === "sanitized" ? "sanitized" : verdict.reason,
			suggestion: verdict.message,
		},
	};
}

export function sendOutcome(response: SmsSendResponse): SmsSendOutcome {
	if (response.status === "sent") {
		return { status: "sent", dryRun: response.dryRun };
	}
	return response;
}

export function heldAfterBlock(
	outcome: SmsSendOutcome,
): { reason: string; retryAt: Date | null } | null {
	if (outcome.status !== "blocked" || outcome.reason !== "quiet-hours") {
		return null;
	}
	return {
		reason: "quiet-hours",
		retryAt: outcome.retryAt ? new Date(outcome.retryAt) : null,
	};
}

export function receiptState(
	types: readonly string[],
): "sent" | "in-progress" | null {
	if (types.includes(SMS_INTERNAL.idempotency.sent)) return "sent";
	if (types.includes(SMS_INTERNAL.idempotency.claimed)) return "in-progress";
	return null;
}
