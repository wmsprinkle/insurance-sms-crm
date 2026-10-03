import { DealStage } from "@crm/db/enums";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { focusOn } from "../lib/focus";
import { SMS_AGENT } from "../lib/sms-config";
import { deliver } from "../lib/sms-delivery";
import { apiSendPath, dryRunFrom } from "../lib/sms-outbound";
import { NOT_AN_SMS_SESSION, smsSessionOf } from "../lib/sms-session";
import { prismaSmsStore } from "../lib/sms-store";

export default defineTool({
	description:
		"Opt the lead out of all texts: suppress the number, revoke consent, close open SMS work, and send the one confirmation. Use it when classify_reply says opt_out or wrong_number. Send nothing after it.",
	inputSchema: z.object({
		reason: z.enum(["opt_out", "wrong_number"]),
	}),
	async execute({ reason }, ctx) {
		const sms = smsSessionOf(ctx);
		if (!sms) return NOT_AN_SMS_SESSION;
		focusOn({ contactId: sms.contactId });

		const contact = await prismaSmsStore.contact(sms.contactId);
		if (!contact?.phone) {
			return {
				ok: false as const,
				reason: "This contact has no phone number on an active record.",
			};
		}

		await prismaSmsStore.optOut({
			contactId: contact.id,
			phone: contact.phone,
			reason,
			keepTaskId: sms.taskId,
		});
		const dealsMoved = await prismaSmsStore.setDealStage(
			contact.id,
			DealStage.UNQUALIFIED_TO_BUY,
		);

		const confirmation = await deliver(
			{
				contactId: contact.id,
				text: SMS_AGENT.messages.optOutConfirmation,
				purpose: "opt-out-confirmation",
				taskId: sms.taskId,
				idempotencyKey: `opt_out_contact:${contact.id}:${ctx.callId}`,
				bookingLink: null,
				disclosure: sms.disclosure,
			},
			{
				store: prismaSmsStore,
				sendPath: apiSendPath(),
				dryRun: dryRunFrom(),
			},
		);

		return {
			ok: true as const,
			optedOut: true as const,
			dealsMoved,
			confirmation: confirmation.status,
			next: "Stop. Send nothing more to this lead.",
		};
	},
});
