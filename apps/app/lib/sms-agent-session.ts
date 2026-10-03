import type { MessageStreamEvent } from "eve/client";
import {
	messagesFromEvents,
	type TranscriptMessage,
	toTranscript,
} from "@/lib/agent-transcript";
import type { RouterOutputs } from "@/lib/trpc/types";

export type SmsAgentSession =
	RouterOutputs["sms"]["agentSessions"]["sessions"][number];

export type SmsAgentSessionView = {
	id: string;
	startedAt: string;
	lastEventAt: string;
	transcript: TranscriptMessage[];
};

function smsSessionView(session: SmsAgentSession): SmsAgentSessionView {
	return {
		id: session.sessionId,
		startedAt: session.startedAt,
		lastEventAt: session.lastEventAt,
		transcript: toTranscript(
			messagesFromEvents(session.events as MessageStreamEvent[]),
		),
	};
}

export function smsSessionViews(
	sessions: readonly SmsAgentSession[],
): SmsAgentSessionView[] {
	return sessions
		.map(smsSessionView)
		.filter((view) => view.transcript.length > 0);
}
