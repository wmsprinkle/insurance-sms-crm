import { apiSendPath } from "./sms-outbound";
import { runSmsTask, type SmsRunDeps, type SmsTurnStart } from "./sms-pipeline";
import { prismaSmsStore } from "./sms-store";
import { completeTask, type LeasedTask, noteSession } from "./tasks";

export function liveSmsDeps(): SmsRunDeps {
	return {
		store: prismaSmsStore,
		sendPath: apiSendPath(),
		complete: completeTask,
		noteSession,
	};
}

export function runLiveSmsTask(
	task: LeasedTask,
	start: (turn: SmsTurnStart) => Promise<{ id: string }>,
): Promise<void> {
	return runSmsTask(task, start, liveSmsDeps());
}

export function finishSmsTurns(
	contactId: string,
	outcome: string,
): Promise<number> {
	return prismaSmsStore.finishStartedTurns(contactId, outcome);
}
