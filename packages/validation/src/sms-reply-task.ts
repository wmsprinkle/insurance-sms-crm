import { z } from "zod";

export const SMS_REPLY_TASK_KIND = "sms-reply";

export const smsReplyTaskPayload = z.object({
	type: z.literal("sms.received"),
	smsMessageIds: z.array(z.string().trim().min(1)).min(1),
	from: z.string().trim().min(1),
});

export type SmsReplyTaskPayload = z.infer<typeof smsReplyTaskPayload>;

export function parseSmsReplyTaskPayload(value: unknown): SmsReplyTaskPayload {
	const parsed = smsReplyTaskPayload.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`Unreadable sms-reply task payload: ${parsed.error.issues
				.map((issue) => `${issue.path.join(".") || "payload"} ${issue.message}`)
				.join("; ")}`,
		);
	}
	return parsed.data;
}
