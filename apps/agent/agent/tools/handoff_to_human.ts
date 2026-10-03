import { defineTool } from "eve/tools";
import { z } from "zod";
import { focusOn } from "../lib/focus";
import { handOff } from "../lib/sms-handoff";
import { apiSendPath, dryRunFrom } from "../lib/sms-outbound";
import { NOT_AN_SMS_SESSION, smsSessionOf } from "../lib/sms-session";
import { prismaSmsStore } from "../lib/sms-store";

export default defineTool({
	description:
		"Give this SMS conversation to a person. The code sends the lead one fixed handoff text, then the agent stops replying to this lead until a rep hands it back. Use it when classify_reply says needs_human.",
	inputSchema: z.object({
		reason: z
			.string()
			.trim()
			.min(5)
			.max(200)
			.describe("One line a rep reads: why a person must answer."),
	}),
	async execute({ reason }, ctx) {
		const sms = smsSessionOf(ctx);
		if (!sms) return NOT_AN_SMS_SESSION;
		focusOn({ contactId: sms.contactId });

		return handOff(
			{
				contactId: sms.contactId,
				reason,
				taskId: sms.taskId,
				idempotencyKey: `handoff_to_human:${sms.contactId}:${ctx.callId}`,
			},
			{
				store: prismaSmsStore,
				sendPath: apiSendPath(),
				dryRun: dryRunFrom(),
			},
		);
	},
});
