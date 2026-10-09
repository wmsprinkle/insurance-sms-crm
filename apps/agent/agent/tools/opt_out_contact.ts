import { defineTool } from "eve/tools";
import { z } from "zod";
import { focusOn } from "../lib/focus";
import { optOutLead } from "../lib/sms-opt-out";
import { apiSendPath } from "../lib/sms-outbound";
import { NOT_AN_SMS_SESSION, smsSessionOf } from "../lib/sms-session";
import { prismaSmsStore } from "../lib/sms-store";

export default defineTool({
	description:
		"Opt the lead out of all texts: suppress the number, revoke consent, close open SMS work, and send the one confirmation. classify_reply with opt_out or wrong_number already does this; call it only when the lead asks to stop without classify_reply. Send nothing after it.",
	inputSchema: z.object({
		reason: z.enum(["opt_out", "wrong_number"]),
	}),
	async execute({ reason }, ctx) {
		const sms = smsSessionOf(ctx);
		if (!sms) return NOT_AN_SMS_SESSION;
		focusOn({ contactId: sms.contactId });

		const outcome = await optOutLead(
			{
				contactId: sms.contactId,
				reason,
				taskId: sms.taskId,
				disclosure: sms.disclosure,
			},
			{
				store: prismaSmsStore,
				sendPath: apiSendPath(),
			},
		);
		if (!outcome.ok) return outcome;

		return { ...outcome, next: "Stop. Send nothing more to this lead." };
	},
});
