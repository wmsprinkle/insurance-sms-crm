import { defineTool } from "eve/tools";
import { OUTBOUND_GUARD, outboundSmsInput } from "../hooks/outbound-guard";
import { focusOn } from "../lib/focus";
import { SMS_AGENT } from "../lib/sms-config";
import { deliver } from "../lib/sms-delivery";
import { apiSendPath, dryRunFrom } from "../lib/sms-outbound";
import {
	NO_TASK_FOR_SEND,
	NOT_AN_SMS_SESSION,
	smsSessionOf,
} from "../lib/sms-session";
import { prismaSmsStore } from "../lib/sms-store";

export default defineTool({
	description: `Text the lead in this SMS conversation. One short message, at most ${OUTBOUND_GUARD.maxChars} characters, no links except the booking link the task gives you. The code checks the text, then sends it or holds it as a draft for a rep and says why. A drafted reply counts as your reply: do not send it again or rephrase it. Call it at most once per inbound message.`,
	inputSchema: outboundSmsInput.describe(
		"body is the exact text the lead will read.",
	),
	async execute({ body }, ctx) {
		const sms = smsSessionOf(ctx);
		if (!sms) return NOT_AN_SMS_SESSION;
		if (!sms.taskId) return NO_TASK_FOR_SEND;
		focusOn({ contactId: sms.contactId });

		return deliver(
			{
				contactId: sms.contactId,
				text: body,
				purpose: "conversation",
				taskId: sms.taskId,
				idempotencyKey: `${SMS_AGENT.keys.reply}${sms.taskId}`,
				oncePerKey: true,
				bookingLink: sms.bookingLink,
				disclosure: sms.disclosure,
			},
			{
				store: prismaSmsStore,
				sendPath: apiSendPath(),
				dryRun: dryRunFrom(),
			},
		);
	},
});
