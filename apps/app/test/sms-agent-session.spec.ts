import { describe, expect, it } from "bun:test";
import {
	type SmsAgentSession,
	smsSessionViews,
} from "../lib/sms-agent-session";

const session = (
	events: SmsAgentSession["events"],
	sessionId = "crm:sms:c1",
): SmsAgentSession => ({
	sessionId,
	startedAt: "2026-10-03T15:00:00.000Z",
	lastEventAt: "2026-10-03T15:01:00.000Z",
	events,
});

describe("smsSessionViews", () => {
	it("returns nothing for a contact with no SMS session", () => {
		expect(smsSessionViews([])).toEqual([]);
	});

	it("drops a session whose events hold nothing to show", () => {
		expect(
			smsSessionViews([
				session([
					{
						type: "session.started",
						data: {},
						meta: { id: "e1", at: "2026-10-03T15:00:00.000Z" },
					},
				]),
			]),
		).toEqual([]);
	});
});
