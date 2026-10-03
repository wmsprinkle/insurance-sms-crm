export const FUNNEL_STATUSES = [
	"new",
	"texted",
	"replied",
	"interested",
	"not_interested",
	"needs_you",
	"booked",
	"opted_out",
	"abusive",
] as const;

export type FunnelStatus = (typeof FUNNEL_STATUSES)[number];

export const FUNNEL_STATUS_LABELS = {
	new: "New",
	texted: "Texted",
	replied: "Replied",
	interested: "Interested",
	not_interested: "Not interested",
	needs_you: "Needs you",
	booked: "Booked",
	opted_out: "Opted out",
	abusive: "Abusive",
} as const satisfies Record<FunnelStatus, string>;

export const FUNNEL_HOLD_REASONS = {
	abusive: "triage:abusive",
	ambiguous: "triage:ambiguous",
} as const;

export const FUNNEL_OUTCOMES = {
	declined: "not-interested",
} as const;

const BOOKED_STAGES: ReadonlySet<string> = new Set([
	"DEMO_BOOKED",
	"DECISION_MAKER_BOUGHT_IN",
	"CONTRACT_SENT",
	"CLOSED_WON",
]);

const QUALIFIED_STAGE = "QUALIFIED_TO_BUY";
const UNQUALIFIED_STAGE = "UNQUALIFIED_TO_BUY";

export type FunnelFacts = {
	suppressed: boolean;
	handoff: { reason: string; resolvedAt: Date | string | null } | null;
	dealStages: readonly string[];
	declined: boolean;
	outbound: number;
	inbound: number;
	modelTurns: number;
	failedTurn?: boolean;
};

export function deriveFunnelStatus(facts: FunnelFacts): FunnelStatus {
	if (facts.suppressed) return "opted_out";

	const hold =
		facts.handoff && facts.handoff.resolvedAt === null ? facts.handoff : null;
	if (hold?.reason === FUNNEL_HOLD_REASONS.abusive) return "abusive";

	if (facts.dealStages.some((stage) => BOOKED_STAGES.has(stage))) {
		return "booked";
	}

	const qualified = facts.dealStages.includes(QUALIFIED_STAGE);
	if (
		!qualified &&
		(facts.dealStages.includes(UNQUALIFIED_STAGE) || facts.declined)
	) {
		return "not_interested";
	}

	if (hold || facts.failedTurn) return "needs_you";
	if (qualified || facts.modelTurns > 0) return "interested";
	if (facts.inbound > 0) return "replied";
	if (facts.outbound > 0) return "texted";
	return "new";
}
