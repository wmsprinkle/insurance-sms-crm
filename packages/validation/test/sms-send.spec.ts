import { describe, expect, it } from "bun:test";
import {
	parseSmsSendResponse,
	SMS_HOLD_REASON_LABELS,
	SMS_HOLD_REASONS,
	smsSendRequest,
} from "../src/sms-send";

const REQUEST = {
	contactId: "c1",
	to: "+15125550100",
	text: "Hi there",
	purpose: "conversation",
	idempotencyKey: "send_sms:call-1",
	taskId: null,
};

describe("smsSendRequest", () => {
	it("accepts a complete request", () => {
		expect(smsSendRequest.parse(REQUEST)).toEqual(REQUEST);
	});

	it("refuses a number that is not E.164", () => {
		expect(
			smsSendRequest.safeParse({ ...REQUEST, to: "512-555-0100" }).success,
		).toBe(false);
	});

	it("refuses text over 480 characters", () => {
		expect(
			smsSendRequest.safeParse({ ...REQUEST, text: "a".repeat(481) }).success,
		).toBe(false);
	});

	it("refuses an unknown purpose", () => {
		expect(
			smsSendRequest.safeParse({ ...REQUEST, purpose: "marketing" }).success,
		).toBe(false);
	});
});

describe("parseSmsSendResponse", () => {
	it("reads each status", () => {
		expect(
			parseSmsSendResponse({ status: "sent", telnyxId: "t1", dryRun: true }),
		).toEqual({ status: "sent", telnyxId: "t1", dryRun: true });
		expect(
			parseSmsSendResponse({
				status: "blocked",
				reason: "quiet-hours",
				retryAt: "2026-10-03T13:00:00.000Z",
			}).status,
		).toBe("blocked");
		expect(parseSmsSendResponse({ status: "failed", error: "x" }).status).toBe(
			"failed",
		);
	});

	it("throws on an unreadable body with the field named", () => {
		expect(() => parseSmsSendResponse({ status: "sent" })).toThrow(/telnyxId/);
	});
});

describe("hold reasons", () => {
	it("label every reason", () => {
		expect(Object.keys(SMS_HOLD_REASON_LABELS).sort()).toEqual(
			[...SMS_HOLD_REASONS].sort(),
		);
	});
});
