import { describe, expect, it } from "bun:test";
import { smsOutcomeNotice, smsTextProblem } from "./sms-drafts";
import { smsComposerBlock } from "./sms-presentation";

describe("smsOutcomeNotice blocked reasons", () => {
	it.each([
		["frequency-cap", "Too many texts without an answer"],
		["unsupported-number", "Number not supported"],
	] as const)("labels %s", (reason, title) => {
		expect(
			smsOutcomeNotice({ status: "blocked", reason, retryAt: null }),
		).toMatchObject({ sent: false, tone: "destructive", title });
	});
});

describe("smsOutcomeNotice", () => {
	it("marks a dry run send as sent", () => {
		const notice = smsOutcomeNotice({ status: "sent", dryRun: true });
		expect(notice.sent).toBe(true);
		expect(notice.title).toContain("dry run");
	});

	it("keeps the retry time for quiet hours", () => {
		expect(
			smsOutcomeNotice({
				status: "blocked",
				reason: "quiet-hours",
				retryAt: "2026-10-04T13:00:00.000Z",
			}),
		).toMatchObject({
			sent: false,
			tone: "warning",
			title: "Held for quiet hours",
			retryAt: "2026-10-04T13:00:00.000Z",
		});
	});

	it("explains consent and suppression blocks", () => {
		expect(
			smsOutcomeNotice({
				status: "blocked",
				reason: "suppressed",
				retryAt: null,
			}).title,
		).toBe("Opted out");
		expect(
			smsOutcomeNotice({
				status: "blocked",
				reason: "no-consent",
				retryAt: null,
			}).tone,
		).toBe("destructive");
	});

	it("offers the guard's suggestion", () => {
		expect(
			smsOutcomeNotice({
				status: "guarded",
				reason: "sanitized",
				suggestion: "Call me today",
			}),
		).toMatchObject({ sent: false, suggestion: "Call me today" });
	});

	it("shows the failure text", () => {
		expect(
			smsOutcomeNotice({ status: "failed", error: "Provider refused" })
				.description,
		).toBe("Provider refused");
	});
});

describe("smsTextProblem", () => {
	it("rejects empty and over-long text", () => {
		expect(smsTextProblem("  ")).toBe("Write a message first.");
		expect(smsTextProblem("x".repeat(481))).toContain("481");
		expect(smsTextProblem("Hi there")).toBeNull();
	});
});

describe("smsComposerBlock", () => {
	const ok = { phone: "+12125550123", suppressed: false, consented: true };

	it("allows a consented, unsuppressed number", () => {
		expect(smsComposerBlock(ok)).toBeNull();
	});

	it("blocks a missing phone, an opt-out and missing consent", () => {
		expect(smsComposerBlock({ ...ok, phone: null })).toContain("phone");
		expect(smsComposerBlock({ ...ok, suppressed: true })).toContain(
			"opted out",
		);
		expect(smsComposerBlock({ ...ok, consented: false })).toContain("consent");
	});
});
