import { DealStage } from "@crm/db/enums";
import type { DisclosureMode } from "@crm/validation/outbound-guard";
import { SMS_AGENT } from "./sms-config";
import { type DeliveryDeps, deliver } from "./sms-delivery";
import type { OptOutReason } from "./sms-store";

export type OptOutRequest = {
	contactId: string;
	reason: OptOutReason;
	taskId: string | null;
	disclosure?: DisclosureMode;
};

export type OptOutOutcome =
	| { ok: false; reason: string }
	| {
			ok: true;
			optedOut: true;
			alreadySuppressed: boolean;
			dealsMoved: number;
			confirmation: "sent" | "drafted" | "later" | "refused" | "skipped";
	  };

export function optOutKey(phone: string, suppressedAt: Date): string {
	return `${SMS_AGENT.keys.optOut}${phone}:${suppressedAt.getTime()}`;
}

export async function optOutLead(
	request: OptOutRequest,
	deps: DeliveryDeps,
): Promise<OptOutOutcome> {
	const contact = await deps.store.contact(request.contactId);
	if (!contact?.phone) {
		return {
			ok: false,
			reason: "This contact has no phone number on an active record.",
		};
	}

	const result = await deps.store.optOut({
		contactId: contact.id,
		phone: contact.phone,
		reason: request.reason,
		keepTaskId: request.taskId,
	});
	const dealsMoved = await deps.store.setDealStage(
		contact.id,
		DealStage.UNQUALIFIED_TO_BUY,
	);

	if (!result.created) {
		return {
			ok: true,
			optedOut: true,
			alreadySuppressed: true,
			dealsMoved,
			confirmation: "skipped",
		};
	}

	const confirmation = await deliver(
		{
			contactId: contact.id,
			text: SMS_AGENT.messages.optOutConfirmation,
			purpose: "opt-out-confirmation",
			taskId: request.taskId,
			idempotencyKey: optOutKey(contact.phone, result.suppressedAt),
			bookingLink: null,
			disclosure: request.disclosure,
		},
		deps,
	);

	return {
		ok: true,
		optedOut: true,
		alreadySuppressed: false,
		dealsMoved,
		confirmation: confirmation.status,
	};
}
