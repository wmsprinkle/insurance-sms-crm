import { SMS_AGENT } from "./sms-config";
import { type Delivery, type DeliveryDeps, deliver } from "./sms-delivery";

export type Handoff =
	| { handedOff: true; alreadyOwned: true; message: null; next: string }
	| { handedOff: true; alreadyOwned: false; message: Delivery; next: string };

const NEXT = "Stop. A person owns this conversation now. Send nothing more.";

export async function handOff(
	input: {
		contactId: string;
		reason: string;
		taskId: string | null;
		idempotencyKey: string;
	},
	deps: DeliveryDeps,
): Promise<Handoff> {
	const opened = await deps.store.openHandoff(input.contactId, input.reason);
	await deps.store.finishSmsTasks(
		input.contactId,
		SMS_AGENT.outcomes.handedOff,
		input.taskId,
	);
	if (!opened) {
		return { handedOff: true, alreadyOwned: true, message: null, next: NEXT };
	}

	const message = await deliver(
		{
			contactId: input.contactId,
			text: SMS_AGENT.messages.handoff,
			purpose: "handoff",
			taskId: input.taskId,
			idempotencyKey: input.idempotencyKey,
			bookingLink: null,
		},
		deps,
	);
	return { handedOff: true, alreadyOwned: false, message, next: NEXT };
}
