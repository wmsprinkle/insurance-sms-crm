import { describe, expect, it } from "bun:test";
import {
	deriveFunnelStatus,
	FUNNEL_HOLD_REASONS,
	FUNNEL_STATUS_LABELS,
	FUNNEL_STATUSES,
	type FunnelFacts,
} from "../src/funnel-status";

const BASE: FunnelFacts = {
	suppressed: false,
	handoff: null,
	dealStages: [],
	declined: false,
	outbound: 0,
	inbound: 0,
	modelTurns: 0,
};

const facts = (patch: Partial<FunnelFacts>): FunnelFacts => ({
	...BASE,
	...patch,
});

describe("deriveFunnelStatus", () => {
	it("is new with no messages", () => {
		expect(deriveFunnelStatus(BASE)).toBe("new");
	});

	it("is texted after the first message", () => {
		expect(deriveFunnelStatus(facts({ outbound: 1 }))).toBe("texted");
	});

	it("is replied once the lead answers and no model has run", () => {
		expect(deriveFunnelStatus(facts({ outbound: 1, inbound: 1 }))).toBe(
			"replied",
		);
	});

	it("is interested once a model turn ran", () => {
		expect(
			deriveFunnelStatus(facts({ outbound: 2, inbound: 2, modelTurns: 1 })),
		).toBe("interested");
	});

	it("is interested for a qualified deal", () => {
		expect(
			deriveFunnelStatus(facts({ dealStages: ["QUALIFIED_TO_BUY"] })),
		).toBe("interested");
	});

	it("is booked for a booked or later deal", () => {
		for (const stage of [
			"DEMO_BOOKED",
			"DECISION_MAKER_BOUGHT_IN",
			"CONTRACT_SENT",
			"CLOSED_WON",
		]) {
			expect(
				deriveFunnelStatus(facts({ dealStages: [stage], modelTurns: 3 })),
			).toBe("booked");
		}
	});

	it("is not_interested for an unqualified deal", () => {
		expect(
			deriveFunnelStatus(
				facts({ dealStages: ["UNQUALIFIED_TO_BUY"], inbound: 1, outbound: 1 }),
			),
		).toBe("not_interested");
	});

	it("is not_interested when a decline is recorded without a deal", () => {
		expect(deriveFunnelStatus(facts({ declined: true, inbound: 1 }))).toBe(
			"not_interested",
		);
	});

	it("a re-qualified lead is no longer not_interested", () => {
		expect(
			deriveFunnelStatus(
				facts({
					dealStages: ["UNQUALIFIED_TO_BUY", "QUALIFIED_TO_BUY"],
					declined: true,
				}),
			),
		).toBe("interested");
	});

	it("is opted_out when the phone is suppressed, over everything", () => {
		expect(
			deriveFunnelStatus(
				facts({
					suppressed: true,
					dealStages: ["DEMO_BOOKED"],
					handoff: { reason: FUNNEL_HOLD_REASONS.abusive, resolvedAt: null },
				}),
			),
		).toBe("opted_out");
	});

	it("is abusive for an open abusive hold", () => {
		expect(
			deriveFunnelStatus(
				facts({
					handoff: { reason: FUNNEL_HOLD_REASONS.abusive, resolvedAt: null },
					inbound: 1,
				}),
			),
		).toBe("abusive");
	});

	it("is needs_you for any other open hold", () => {
		for (const reason of [
			FUNNEL_HOLD_REASONS.ambiguous,
			"hourly message limit",
			"suspected prompt injection",
			"needs a licensed agent",
		]) {
			expect(
				deriveFunnelStatus(
					facts({
						handoff: { reason, resolvedAt: null },
						inbound: 1,
						outbound: 1,
					}),
				),
			).toBe("needs_you");
		}
	});

	it("ignores a resolved hold", () => {
		expect(
			deriveFunnelStatus(
				facts({
					handoff: {
						reason: FUNNEL_HOLD_REASONS.abusive,
						resolvedAt: "2026-10-03T10:00:00Z",
					},
					inbound: 1,
					outbound: 1,
				}),
			),
		).toBe("replied");
	});

	it("keeps needs_you above interested", () => {
		expect(
			deriveFunnelStatus(
				facts({
					handoff: { reason: "x", resolvedAt: null },
					modelTurns: 2,
				}),
			),
		).toBe("needs_you");
	});

	it("is needs_you when the last model turn failed, even after a model turn started", () => {
		expect(
			deriveFunnelStatus(
				facts({ failedTurn: true, modelTurns: 1, inbound: 1, outbound: 1 }),
			),
		).toBe("needs_you");
	});

	it("keeps a declined or opted out lead closed despite a failed turn", () => {
		expect(
			deriveFunnelStatus(facts({ failedTurn: true, declined: true })),
		).toBe("not_interested");
		expect(
			deriveFunnelStatus(facts({ failedTurn: true, suppressed: true })),
		).toBe("opted_out");
	});

	it("labels every status", () => {
		for (const status of FUNNEL_STATUSES) {
			expect(FUNNEL_STATUS_LABELS[status].length).toBeGreaterThan(0);
		}
		expect(FUNNEL_STATUS_LABELS.needs_you).toBe("Needs you");
	});
});
