import { SMS_BLOCK_REASONS } from "@crm/validation/sms-send";
import { z } from "zod";
import { SMS_DRAFTS } from "./drafts.config";

const smsDraftRow = z.object({
	id: z.string(),
	contactId: z.string(),
	name: z.string(),
	phone: z.string().nullable(),
	body: z.string(),
	reason: z.string(),
	reasonLabel: z.string(),
	retryAt: z.string().nullable(),
	createdAt: z.string(),
	handedOff: z.boolean(),
	firstMessage: z.boolean(),
});

type SmsDraftRow = z.infer<typeof smsDraftRow>;

const smsHandoffRow = z.object({
	id: z.string(),
	contactId: z.string(),
	name: z.string(),
	phone: z.string().nullable(),
	reason: z.string(),
	createdAt: z.string(),
});

type SmsHandoffRow = z.infer<typeof smsHandoffRow>;

export const smsDraftQueueOutput = z.object({
	drafts: z.array(smsDraftRow),
	handoffs: z.array(smsHandoffRow),
	truncated: z.boolean(),
});

export type SmsDraftQueueOutput = z.infer<typeof smsDraftQueueOutput>;

const smsText = z.string().trim().min(1).max(480);

export const smsDraftApproveInput = z.object({
	draftId: z.string().trim().min(1),
	text: smsText.optional(),
});

export type SmsDraftApproveInput = z.infer<typeof smsDraftApproveInput>;

export const smsDraftIdInput = z.object({
	draftId: z.string().trim().min(1),
});

export type SmsDraftIdInput = z.infer<typeof smsDraftIdInput>;

export const smsDraftBulkInput = z.object({
	draftIds: z
		.array(z.string().trim().min(1))
		.min(1)
		.max(SMS_DRAFTS.bulk.maxDrafts),
});

export type SmsDraftBulkInput = z.infer<typeof smsDraftBulkInput>;

export const smsComposeInput = z.object({
	contactId: z.string().trim().min(1),
	text: smsText,
	idempotencyKey: z.string().trim().min(8).max(100),
});

export type SmsComposeInput = z.infer<typeof smsComposeInput>;

export const smsHandBackInput = z.object({
	contactId: z.string().trim().min(1),
});

export type SmsHandBackInput = z.infer<typeof smsHandBackInput>;

const SMS_GUARD_REASONS = [
	"sanitized",
	"breaks_character",
	"empty_after_sanitize",
	"price_or_guarantee",
] as const;

type SmsGuardReason = (typeof SMS_GUARD_REASONS)[number];

export const smsSendOutcome = z.discriminatedUnion("status", [
	z.object({ status: z.literal("sent"), dryRun: z.boolean() }),
	z.object({
		status: z.literal("blocked"),
		reason: z.enum(SMS_BLOCK_REASONS),
		retryAt: z.string().nullable(),
	}),
	z.object({
		status: z.literal("guarded"),
		reason: z.enum(SMS_GUARD_REASONS),
		suggestion: z.string(),
	}),
	z.object({ status: z.literal("failed"), error: z.string() }),
]);

export type SmsSendOutcome = z.infer<typeof smsSendOutcome>;

export const smsDraftDiscardOutput = z.object({ discarded: z.boolean() });

export type SmsDraftDiscardOutput = z.infer<typeof smsDraftDiscardOutput>;

export const smsHandBackOutput = z.object({
	resolved: z.boolean(),
	queued: z.boolean(),
});

export type SmsHandBackOutput = z.infer<typeof smsHandBackOutput>;

export const smsDraftApproveAllOutput = z.object({
	items: z.array(
		z.object({
			draftId: z.string(),
			contactId: z.string().nullable(),
			name: z.string(),
			outcome: smsSendOutcome,
		}),
	),
});

export type SmsDraftApproveAllOutput = z.infer<typeof smsDraftApproveAllOutput>;

export const smsDraftDiscardAllOutput = z.object({ discarded: z.number() });

export type SmsDraftDiscardAllOutput = z.infer<typeof smsDraftDiscardAllOutput>;
