import { z } from "zod";
import { e164 } from "./phone";

export const SMS_SEND_PATH = "/internal/sms/send";

export const SMS_SEND_PURPOSES = [
	"conversation",
	"first-touch",
	"handoff",
	"opt-out-confirmation",
] as const;

export type SmsSendPurpose = (typeof SMS_SEND_PURPOSES)[number];

export const smsSendRequest = z.object({
	contactId: z.string().trim().min(1),
	to: e164,
	text: z.string().trim().min(1).max(480),
	purpose: z.enum(SMS_SEND_PURPOSES),
	idempotencyKey: z.string().trim().min(1).max(200),
	taskId: z.string().trim().min(1).nullable(),
	dryRun: z.boolean(),
});

export type SmsSendRequest = z.infer<typeof smsSendRequest>;

export const SMS_BLOCK_REASONS = [
	"suppressed",
	"no-consent",
	"quiet-hours",
] as const;

export const smsSendResponse = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("sent"),
		telnyxId: z.string().min(1),
		dryRun: z.boolean(),
	}),
	z.object({
		status: z.literal("blocked"),
		reason: z.enum(SMS_BLOCK_REASONS),
		retryAt: z.iso.datetime().nullable(),
	}),
	z.object({
		status: z.literal("failed"),
		error: z.string(),
	}),
]);

export type SmsSendResponse = z.infer<typeof smsSendResponse>;

export function parseSmsSendResponse(value: unknown): SmsSendResponse {
	const parsed = smsSendResponse.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`Unreadable sms send response: ${parsed.error.issues
				.map(
					(issue) => `${issue.path.join(".") || "response"} ${issue.message}`,
				)
				.join("; ")}`,
		);
	}
	return parsed.data;
}

export const SMS_HOLD_REASONS = [
	"approval-mode",
	"quiet-hours",
	"send-failed",
	"no-send-path",
] as const;

export type SmsHoldReason = (typeof SMS_HOLD_REASONS)[number];

export const SMS_HOLD_REASON_LABELS = {
	"approval-mode": "Auto send is off, so a rep approves each reply.",
	"quiet-hours": "The lead's local time is inside quiet hours.",
	"send-failed": "The SMS provider did not accept the message.",
	"no-send-path": "The agent cannot reach the API to send SMS.",
} as const satisfies Record<SmsHoldReason, string>;
