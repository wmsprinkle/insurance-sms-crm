import type { InboundOutcome } from "./sms.service";
import type { TelnyxInbound } from "./telnyx-event";

export const SIMULATE = {
	telnyxIdPrefix: "sim-",
	fallbackTo: "+10000000000",
	firstMessageKeyPrefix: "sim-first:",
	refusal:
		"Test mode is off, so replies cannot be simulated. Set DRY_RUN to true to use this.",
	outcomeSummaries: {
		stored: "The reply was stored and the agent was asked to answer it.",
		"stored-no-reply":
			"The reply was stored. The agent does not answer this conversation.",
		duplicate: "The reply was already stored.",
		"unknown-sender": "No lead has this number.",
		"invalid-sender": "The lead has no usable phone number.",
	},
	fallbackSummary: "The reply was handled as a keyword.",
} as const;

export function simulatedInbound(input: {
	from: string;
	to: string | null;
	text: string;
	id: string;
}): TelnyxInbound {
	return {
		kind: "received",
		eventId: `${SIMULATE.telnyxIdPrefix}event-${input.id}`,
		telnyxId: `${SIMULATE.telnyxIdPrefix}${input.id}`,
		from: input.from,
		to: input.to ?? SIMULATE.fallbackTo,
		text: input.text,
	};
}

export function simulateSummary(outcome: InboundOutcome): string {
	switch (outcome) {
		case "stored":
		case "stored-no-reply":
		case "duplicate":
		case "unknown-sender":
		case "invalid-sender":
			return SIMULATE.outcomeSummaries[outcome];
		default:
			return SIMULATE.fallbackSummary;
	}
}
