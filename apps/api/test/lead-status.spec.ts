import { describe, expect, it } from "bun:test";
import {
	type LeadOverlay,
	type LeadStatus,
	leadStatusOf,
	statusCounts,
} from "../src/today/lead-status";
import { messageLabel, sortTimeline } from "../src/today/timeline";

const NONE: LeadOverlay = {
	booked: false,
	pendingDraft: false,
	unknownSend: false,
};

function status(funnel: LeadStatus, overlay: Partial<LeadOverlay> = {}) {
	return leadStatusOf(funnel, { ...NONE, ...overlay });
}

describe("leadStatusOf", () => {
	it("keeps the funnel status when nothing else applies", () => {
		expect(status("new")).toBe("new");
		expect(status("texted")).toBe("texted");
		expect(status("interested")).toBe("interested");
	});

	it("needs you for a draft or an unknown send", () => {
		expect(status("replied", { pendingDraft: true })).toBe("needs_you");
		expect(status("texted", { unknownSend: true })).toBe("needs_you");
	});

	it("a calendar booking makes the lead booked", () => {
		expect(status("interested", { booked: true })).toBe("booked");
		expect(status("needs_you", { booked: true })).toBe("booked");
	});

	it("does not reopen a lead that said no", () => {
		expect(status("not_interested", { pendingDraft: true })).toBe(
			"not_interested",
		);
	});

	it("opted out and abusive always win", () => {
		expect(status("opted_out", { booked: true })).toBe("opted_out");
		expect(status("abusive", { pendingDraft: true })).toBe("abusive");
	});
});

describe("statusCounts", () => {
	it("counts every status, including empty ones", () => {
		const counts = statusCounts(["new", "new", "booked"]);
		expect(counts.new).toBe(2);
		expect(counts.booked).toBe(1);
		expect(counts.opted_out).toBe(0);
	});
});

describe("timeline", () => {
	it("sorts oldest first and keeps the latest events", () => {
		const events = [
			{ at: new Date(3000), kind: "sent" as const, label: "c" },
			{ at: new Date(1000), kind: "imported" as const, label: "a" },
			{ at: new Date(2000), kind: "replied" as const, label: "b" },
		];
		expect(sortTimeline(events, 2).map((e) => e.label)).toEqual(["b", "c"]);
	});

	it("labels directions", () => {
		expect(messageLabel("INBOUND").kind).toBe("replied");
		expect(messageLabel("OUTBOUND").kind).toBe("sent");
	});
});
