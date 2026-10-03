import { DealStage } from "@crm/db/enums";
import {
	judgeQualification,
	qualificationFacts,
} from "@crm/validation/sms-qualification";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { focusOn } from "../lib/focus";
import {
	readQualification,
	writeQualification,
} from "../lib/sms-qualification";
import { NOT_AN_SMS_SESSION, smsSessionOf } from "../lib/sms-session";
import { prismaSmsStore } from "../lib/sms-store";

export default defineTool({
	description:
		"Record the qualification facts the lead just stated in this SMS conversation. Pass only facts the lead said; leave the rest out. Never pass health details, a date of birth or an exact age. The result says whether the lead is qualified, what is still missing, or why the lead is rejected.",
	inputSchema: qualificationFacts.extend({
		underAge: z
			.boolean()
			.describe("True only when the lead says they are under 18.")
			.optional(),
	}),
	async execute({ underAge, ...facts }, ctx) {
		const sms = smsSessionOf(ctx);
		if (!sms) return NOT_AN_SMS_SESSION;
		focusOn({ contactId: sms.contactId });

		const { written, refused } = await writeQualification(sms.contactId, facts);
		const known = await readQualification(sms.contactId);
		const { licensedStates } = await prismaSmsStore.settings();
		const verdict = judgeQualification(known, licensedStates, {
			underAge,
		});

		if (verdict.status === "incomplete") {
			return {
				ok: true as const,
				written,
				refused,
				verdict,
				next: `Ask for one missing fact: ${verdict.missing[0]}.`,
			};
		}

		const stage =
			verdict.status === "qualified"
				? DealStage.QUALIFIED_TO_BUY
				: DealStage.UNQUALIFIED_TO_BUY;
		const dealsMoved = await prismaSmsStore.setDealStage(sms.contactId, stage);

		return {
			ok: true as const,
			written,
			refused,
			verdict,
			dealsMoved,
			next:
				verdict.status === "qualified"
					? "The lead is qualified. Offer call times."
					: `The lead is rejected: ${verdict.reason} Send one polite close with send_sms.`,
		};
	},
});
