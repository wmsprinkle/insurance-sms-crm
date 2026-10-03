import type { SmsHoldReason, SmsSendPurpose } from "@crm/validation/sms-send";
import {
	type DisclosureMode,
	guardOutbound,
	type OutboundVerdict,
} from "../hooks/outbound-guard";
import { explainHold, holdBeforeSend, judgeAttempt } from "./approval-sms";
import type { SendPath } from "./sms-outbound";
import type { SmsStore } from "./sms-store";

export type DeliveryRequest = {
	contactId: string;
	text: string;
	purpose: SmsSendPurpose;
	taskId: string | null;
	idempotencyKey: string;
	bookingLink: string | null;
	disclosure?: DisclosureMode;
	quietHours?: "draft" | "defer";
};

export type Delivery =
	| {
			status: "sent";
			text: string;
			guard: OutboundVerdict["kind"];
			telnyxId: string;
			dryRun: boolean;
	  }
	| {
			status: "drafted";
			text: string;
			guard: OutboundVerdict["kind"];
			draftId: string;
			reason: SmsHoldReason;
			retryAt: string | null;
			detail: string;
	  }
	| { status: "later"; text: string; retryAt: Date }
	| { status: "refused"; reason: string };

export type DeliveryDeps = {
	store: SmsStore;
	sendPath: SendPath;
	dryRun: boolean;
};

const HANDOFF_EXEMPT = new Set<SmsSendPurpose>([
	"handoff",
	"opt-out-confirmation",
]);

export async function deliver(
	request: DeliveryRequest,
	deps: DeliveryDeps,
): Promise<Delivery> {
	const contact = await deps.store.contact(request.contactId);
	if (!contact?.phone) {
		return {
			status: "refused",
			reason: "This contact has no phone number on an active record.",
		};
	}

	if (!HANDOFF_EXEMPT.has(request.purpose)) {
		const handoff = await deps.store.activeHandoff(request.contactId);
		if (handoff) {
			return {
				status: "refused",
				reason: `A person owns this conversation (${handoff.reason}). Send nothing.`,
			};
		}
	}

	const settings = await deps.store.settings();
	const verdict = guardOutbound({
		message: request.text,
		bookingLink: request.bookingLink,
		disclosure: request.disclosure ?? settings.disclosureMode,
	});

	const hold = async (
		reason: SmsHoldReason,
		retryAt: Date | null,
		detail: string | null,
	): Promise<Delivery> => {
		const draft = await deps.store.saveDraft({
			contactId: request.contactId,
			body: verdict.message,
			reason,
			retryAt,
			taskId: request.taskId,
		});
		return {
			status: "drafted",
			text: verdict.message,
			guard: verdict.kind,
			draftId: draft.id,
			reason,
			retryAt: retryAt?.toISOString() ?? null,
			detail: explainHold(reason, retryAt, detail),
		};
	};

	const before = holdBeforeSend(settings, request.purpose);
	if (before) return hold(before, null, null);

	const attempt = await deps.sendPath({
		contactId: request.contactId,
		to: contact.phone,
		text: verdict.message,
		purpose: request.purpose,
		idempotencyKey: request.idempotencyKey,
		taskId: request.taskId,
		dryRun: deps.dryRun,
	});
	const judged = judgeAttempt(attempt);

	switch (judged.kind) {
		case "sent":
			return {
				status: "sent",
				text: verdict.message,
				guard: verdict.kind,
				telnyxId: judged.telnyxId,
				dryRun: judged.dryRun,
			};
		case "hold":
			if (
				judged.reason === "quiet-hours" &&
				judged.retryAt &&
				request.quietHours === "defer"
			) {
				return {
					status: "later",
					text: verdict.message,
					retryAt: judged.retryAt,
				};
			}
			return hold(judged.reason, judged.retryAt, judged.detail);
		case "refused":
			return { status: "refused", reason: judged.reason };
	}
}
