import { DealStage } from "@crm/db/enums";
import {
	judgeQualification,
	SMS_DEAL_STAGE,
	SMS_NEXT_ACTION,
	smsReplyClass,
} from "@crm/validation/sms-qualification";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { focusOn } from "../lib/focus";
import { SMS_AGENT } from "../lib/sms-config";
import { readQualification } from "../lib/sms-qualification";
import { smsSessionOf } from "../lib/sms-session";
import { prismaSmsStore } from "../lib/sms-store";

export default defineTool({
	description:
		"Classify the lead's latest SMS before you reply. Pick exactly one value; when two fit, take the one listed first in the qualification skill. opt_out beats everything. The result says what to do next.",
	inputSchema: z.object({
		label: smsReplyClass.describe(
			"opt_out | wrong_number | needs_human | not_interested | qualified | interested | question",
		),
		quote: z
			.string()
			.max(200)
			.describe("The words in the lead's message that decided it.")
			.optional(),
	}),
	async execute({ label }, ctx) {
		const sms = smsSessionOf(ctx);
		if (!sms) {
			return { label, next: SMS_NEXT_ACTION[label], recorded: false as const };
		}
		focusOn({ contactId: sms.contactId });

		if (label === "qualified") {
			const verdict = judgeQualification(
				await readQualification(sms.contactId),
				SMS_AGENT.licensedStates,
			);
			if (verdict.status === "incomplete") {
				return {
					label: "interested" as const,
					next: `Not qualified yet: ${verdict.missing.join(", ")} still missing. ${SMS_NEXT_ACTION.interested}`,
					recorded: false as const,
				};
			}
			if (verdict.status === "disqualified") {
				const moved = await prismaSmsStore.setDealStage(
					sms.contactId,
					DealStage.UNQUALIFIED_TO_BUY,
				);
				return {
					label,
					next: `Disqualified: ${verdict.reason} Send one polite close with send_sms.`,
					dealsMoved: moved,
					recorded: true as const,
				};
			}
		}

		const stage = SMS_DEAL_STAGE[label];
		const moved = stage
			? await prismaSmsStore.setDealStage(sms.contactId, DealStage[stage])
			: 0;

		return {
			label,
			next: SMS_NEXT_ACTION[label],
			dealsMoved: moved,
			recorded: true as const,
		};
	},
});
