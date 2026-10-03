import { DealStage } from "@crm/db/enums";
import { FUNNEL_HOLD_REASONS } from "@crm/validation/funnel-status";
import type { SmsAmbiguousMode } from "@crm/validation/sms-settings";
import { type SmsTriage, triageBatch } from "@crm/validation/sms-triage";
import { SMS_AGENT } from "./sms-config";
import type { DeliveryDeps } from "./sms-delivery";
import { optOutLead } from "./sms-opt-out";

export type TriageStop = { outcome: string };

export function triageInbound(inbound: readonly string[]): SmsTriage {
	return triageBatch(inbound);
}

export async function declineLead(
	contactId: string,
	taskId: string | null,
	deps: Pick<DeliveryDeps, "store">,
): Promise<number> {
	await deps.store.finishSmsTasks(
		contactId,
		SMS_AGENT.outcomes.notInterested,
		taskId,
	);
	await deps.store.discardDrafts(contactId);
	await deps.store.markInboundHandled(contactId);
	return deps.store.setDealStage(contactId, DealStage.UNQUALIFIED_TO_BUY);
}

export async function flagAbusive(
	contactId: string,
	taskId: string | null,
	deps: Pick<DeliveryDeps, "store">,
): Promise<void> {
	await deps.store.openHandoff(contactId, FUNNEL_HOLD_REASONS.abusive);
	await deps.store.finishSmsTasks(
		contactId,
		SMS_AGENT.outcomes.abusive,
		taskId,
	);
	await deps.store.discardDrafts(contactId);
	await deps.store.markInboundHandled(contactId);
}

export async function holdAmbiguous(
	contactId: string,
	taskId: string | null,
	deps: Pick<DeliveryDeps, "store">,
): Promise<void> {
	await deps.store.openHandoff(contactId, FUNNEL_HOLD_REASONS.ambiguous);
	await deps.store.finishSmsTasks(
		contactId,
		SMS_AGENT.outcomes.needsYou,
		taskId,
	);
}

export async function applyTriage(
	input: {
		verdict: SmsTriage;
		contactId: string;
		taskId: string;
		conversationStarted: boolean;
		ambiguousMode: SmsAmbiguousMode;
	},
	deps: DeliveryDeps,
): Promise<TriageStop | null> {
	const { verdict, contactId, taskId } = input;

	if (verdict.label === "abusive") {
		await flagAbusive(contactId, taskId, deps);
		return {
			outcome: `${SMS_AGENT.outcomes.abusive}: flagged for a person (${verdict.rule})`,
		};
	}

	if (verdict.label === "negative") {
		if (verdict.rule === "opt-out" || verdict.rule === "wrong-number") {
			await optOutLead(
				{
					contactId,
					reason: verdict.rule === "opt-out" ? "opt_out" : "wrong_number",
					taskId,
				},
				deps,
			);
			await deps.store.markInboundHandled(contactId);
			return {
				outcome: `${SMS_AGENT.outcomes.optedOut}: ${verdict.rule} reply`,
			};
		}
		await declineLead(contactId, taskId, deps);
		return {
			outcome: `${SMS_AGENT.outcomes.notInterested}: the lead declined`,
		};
	}

	if (
		verdict.label === "ambiguous" &&
		!input.conversationStarted &&
		input.ambiguousMode === "human"
	) {
		await holdAmbiguous(contactId, taskId, deps);
		return {
			outcome: `${SMS_AGENT.outcomes.needsYou}: an unclear first reply waits for a person`,
		};
	}

	return null;
}
