import { z } from "zod";

export const SIMULATE_LIMITS = {
	body: { minLength: 1, maxLength: 480 },
} as const;

export const smsSimulateInboundInput = z.object({
	contactId: z.string().trim().min(1),
	body: z
		.string()
		.trim()
		.min(SIMULATE_LIMITS.body.minLength, "Type the reply to simulate.")
		.max(
			SIMULATE_LIMITS.body.maxLength,
			`A reply is at most ${SIMULATE_LIMITS.body.maxLength} characters.`,
		),
});

export type SmsSimulateInboundInput = z.infer<typeof smsSimulateInboundInput>;

export const smsSimulateInboundOutput = z.object({
	outcome: z.string(),
	summary: z.string(),
});

export type SmsSimulateInboundOutput = z.infer<typeof smsSimulateInboundOutput>;

export const smsSendTestFirstMessageInput = z.object({
	contactId: z.string().trim().min(1),
});

export type SmsSendTestFirstMessageInput = z.infer<
	typeof smsSendTestFirstMessageInput
>;

export const smsSendTestFirstMessageOutput = z.object({
	status: z.enum(["sent", "blocked", "failed"]),
	summary: z.string(),
	text: z.string(),
});

export type SmsSendTestFirstMessageOutput = z.infer<
	typeof smsSendTestFirstMessageOutput
>;
