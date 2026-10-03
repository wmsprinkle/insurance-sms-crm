import { describe, expect, it } from "bun:test";
import { OUTBOUND_GUARD } from "../agent/hooks/outbound-guard";
import {
	explainHold,
	holdBeforeSend,
	judgeAttempt,
} from "../agent/lib/approval-sms";
import { SMS_AGENT } from "../agent/lib/sms-config";
import { type DeliveryRequest, deliver } from "../agent/lib/sms-delivery";
import { handOff } from "../agent/lib/sms-handoff";
import { apiSendPath, dryRunFrom } from "../agent/lib/sms-outbound";
import { fakeSms, LEAD, recordingPath } from "./support/sms-fakes";

const REQUEST: DeliveryRequest = {
	contactId: LEAD.id,
	text: "Happy to help. Which state do you live in?",
	purpose: "conversation",
	taskId: "t1",
	idempotencyKey: "send_sms:call-1",
	bookingLink: null,
};

const SENT = { status: "sent", telnyxId: "tx-1", dryRun: true } as const;

describe("holdBeforeSend", () => {
	it("holds model text when auto send is off", () => {
		expect(holdBeforeSend({ autoSend: false }, "conversation")).toBe(
			"approval-mode",
		);
		expect(holdBeforeSend({ autoSend: false }, "first-touch")).toBe(
			"approval-mode",
		);
	});

	it("never holds the fixed compliance texts", () => {
		expect(holdBeforeSend({ autoSend: false }, "handoff")).toBeNull();
		expect(
			holdBeforeSend({ autoSend: false }, "opt-out-confirmation"),
		).toBeNull();
	});

	it("sends when auto send is on", () => {
		expect(holdBeforeSend({ autoSend: true }, "conversation")).toBeNull();
	});
});

describe("judgeAttempt", () => {
	it("holds quiet hours with the retry time", () => {
		expect(
			judgeAttempt({
				status: "blocked",
				reason: "quiet-hours",
				retryAt: "2026-10-03T13:00:00.000Z",
			}),
		).toEqual({
			kind: "hold",
			reason: "quiet-hours",
			retryAt: new Date("2026-10-03T13:00:00.000Z"),
			detail: "The send gate blocked it for quiet hours.",
		});
	});

	it("refuses suppressed and unconsented numbers without a draft", () => {
		expect(
			judgeAttempt({ status: "blocked", reason: "suppressed", retryAt: null })
				.kind,
		).toBe("refused");
		expect(
			judgeAttempt({ status: "blocked", reason: "no-consent", retryAt: null })
				.kind,
		).toBe("refused");
	});

	it("refuses an unsupported number and holds a frequency cap as failed", () => {
		expect(
			judgeAttempt({
				status: "blocked",
				reason: "unsupported-number",
				retryAt: null,
			}),
		).toMatchObject({ kind: "refused" });
		expect(
			judgeAttempt({
				status: "blocked",
				reason: "frequency-cap",
				retryAt: "2026-10-04T15:00:00.000Z",
			}),
		).toMatchObject({ kind: "hold", reason: "send-failed", retryAt: null });
	});

	it("holds a provider failure and a missing send path", () => {
		expect(judgeAttempt({ status: "failed", error: "boom" })).toMatchObject({
			kind: "hold",
			reason: "send-failed",
		});
		expect(
			judgeAttempt({ status: "unavailable", reason: "unset" }),
		).toMatchObject({ kind: "hold", reason: "no-send-path" });
	});
});

describe("deliver", () => {
	it("drafts by default because auto send is off", async () => {
		const fake = fakeSms();
		const send = recordingPath(SENT);

		const result = await deliver(REQUEST, {
			store: fake.store,
			sendPath: send.path,
			dryRun: true,
		});

		expect(result).toMatchObject({
			status: "drafted",
			reason: "approval-mode",
		});
		expect(send.calls).toHaveLength(0);
		expect(fake.drafts).toHaveLength(1);
		expect(fake.drafts[0]).toMatchObject({
			contactId: LEAD.id,
			reason: "approval-mode",
			taskId: "t1",
		});
	});

	it("sends through the bridge when auto send is on and passes dry run", async () => {
		const fake = fakeSms({ autoSend: true });
		const send = recordingPath(SENT);

		const result = await deliver(REQUEST, {
			store: fake.store,
			sendPath: send.path,
			dryRun: true,
		});

		expect(result).toMatchObject({ status: "sent", telnyxId: "tx-1" });
		expect(send.calls[0]).toMatchObject({
			to: LEAD.phone,
			purpose: "conversation",
			idempotencyKey: "send_sms:call-1",
			dryRun: true,
		});
	});

	it("names the business when the reply must identify it", async () => {
		const fake = fakeSms({ autoSend: true, brandName: "Acme Life" });
		const send = recordingPath(SENT);

		await deliver(
			{ ...REQUEST, identify: true },
			{ store: fake.store, sendPath: send.path, dryRun: true },
		);

		expect(send.calls[0]?.text).toBe(`Acme Life: ${REQUEST.text}`);
	});

	it("does not name the business twice", async () => {
		const fake = fakeSms({ autoSend: true, brandName: "Acme Life" });
		const send = recordingPath(SENT);
		const text = "Acme Life here. Which state do you live in?";

		await deliver(
			{ ...REQUEST, text, identify: true },
			{ store: fake.store, sendPath: send.path, dryRun: true },
		);

		expect(send.calls[0]?.text).toBe(text);
	});

	it("leaves a later reply alone", async () => {
		const fake = fakeSms({ autoSend: true, brandName: "Acme Life" });
		const send = recordingPath(SENT);

		await deliver(REQUEST, {
			store: fake.store,
			sendPath: send.path,
			dryRun: true,
		});

		expect(send.calls[0]?.text).toBe(REQUEST.text);
	});

	it("puts the name in the draft too", async () => {
		const fake = fakeSms({ brandName: "Acme Life" });

		await deliver(
			{ ...REQUEST, identify: true },
			{
				store: fake.store,
				sendPath: recordingPath(SENT).path,
				dryRun: true,
			},
		);

		expect(fake.drafts[0]?.body).toStartWith("Acme Life: ");
	});

	it("guards the text before it leaves", async () => {
		const fake = fakeSms({ autoSend: true });
		const send = recordingPath(SENT);

		await deliver(
			{ ...REQUEST, text: "As an AI language model I cannot quote prices." },
			{ store: fake.store, sendPath: send.path, dryRun: true },
		);

		expect(send.calls[0]?.text).toBe(OUTBOUND_GUARD.safeFallback);
	});

	it("strips contact details from a draft too", async () => {
		const fake = fakeSms();
		await deliver(
			{ ...REQUEST, text: "Email me at a@b.com or call 512-555-0199." },
			{ store: fake.store, sendPath: recordingPath(SENT).path, dryRun: true },
		);

		expect(fake.drafts[0]?.body).not.toContain("a@b.com");
		expect(fake.drafts[0]?.body).not.toContain("555-0199");
	});

	it("uses the deflect mode from settings", async () => {
		const fake = fakeSms({ autoSend: true, disclosureMode: "deflect" });
		const send = recordingPath(SENT);

		await deliver(
			{ ...REQUEST, text: "I'm an automated assistant for the agency." },
			{ store: fake.store, sendPath: send.path, dryRun: true },
		);

		expect(send.calls[0]?.text).toBe(OUTBOUND_GUARD.safeFallback);
	});

	it("drafts a quiet-hours block with the retry time", async () => {
		const fake = fakeSms({ autoSend: true });
		const result = await deliver(REQUEST, {
			store: fake.store,
			sendPath: recordingPath({
				status: "blocked",
				reason: "quiet-hours",
				retryAt: "2026-10-04T13:00:00.000Z",
			}).path,
			dryRun: true,
		});

		expect(result).toMatchObject({
			status: "drafted",
			reason: "quiet-hours",
			retryAt: "2026-10-04T13:00:00.000Z",
		});
	});

	it("drafts when the API send path is missing", async () => {
		const fake = fakeSms({ autoSend: true });
		const result = await deliver(REQUEST, {
			store: fake.store,
			sendPath: apiSendPath({}),
			dryRun: true,
		});

		expect(result).toMatchObject({ status: "drafted", reason: "no-send-path" });
	});

	it("refuses a suppressed number and saves nothing", async () => {
		const fake = fakeSms({ autoSend: true });
		const result = await deliver(REQUEST, {
			store: fake.store,
			sendPath: recordingPath({
				status: "blocked",
				reason: "suppressed",
				retryAt: null,
			}).path,
			dryRun: true,
		});

		expect(result.status).toBe("refused");
		expect(fake.drafts).toHaveLength(0);
	});

	it("refuses while a person owns the conversation", async () => {
		const fake = fakeSms({ autoSend: true });
		fake.handoffs.set(LEAD.id, { reason: "complaint", resolved: false });
		const send = recordingPath(SENT);

		const result = await deliver(REQUEST, {
			store: fake.store,
			sendPath: send.path,
			dryRun: true,
		});

		expect(result.status).toBe("refused");
		expect(send.calls).toHaveLength(0);
	});

	it("refuses a contact with no phone", async () => {
		const fake = fakeSms({ autoSend: true });
		fake.contacts.set(LEAD.id, { ...LEAD, phone: null });

		const result = await deliver(REQUEST, {
			store: fake.store,
			sendPath: recordingPath(SENT).path,
			dryRun: true,
		});

		expect(result.status).toBe("refused");
	});
});

describe("handOff", () => {
	it("sends one handoff text even in approval mode, then stops", async () => {
		const fake = fakeSms();
		const send = recordingPath(SENT);
		const deps = { store: fake.store, sendPath: send.path, dryRun: true };
		const input = {
			contactId: LEAD.id,
			reason: "asks about a claim",
			taskId: "t1",
			idempotencyKey: "handoff:1",
		};

		const first = await handOff(input, deps);
		const second = await handOff(input, deps);

		expect(first).toMatchObject({ handedOff: true, alreadyOwned: false });
		expect(second).toMatchObject({ handedOff: true, alreadyOwned: true });
		expect(send.calls).toHaveLength(1);
		expect(send.calls[0]).toMatchObject({
			purpose: "handoff",
			text: SMS_AGENT.messages.handoff,
		});
		expect(fake.finished[0]).toEqual({
			contactId: LEAD.id,
			outcome: SMS_AGENT.outcomes.handedOff,
			keep: "t1",
		});

		const after = await deliver(REQUEST, deps);
		expect(after.status).toBe("refused");
	});
});

describe("apiSendPath", () => {
	const env = { API_URL: "http://api.test", AGENT_BRIDGE_SECRET: "s3cret" };
	const request = {
		contactId: LEAD.id,
		to: LEAD.phone,
		text: "hi",
		purpose: "conversation" as const,
		idempotencyKey: "k",
		taskId: null,
		dryRun: true,
	};

	it("is unavailable without API_URL or the bridge secret", async () => {
		expect(await apiSendPath({ API_URL: "http://api.test" })(request)).toEqual({
			status: "unavailable",
			reason: "API_URL or AGENT_BRIDGE_SECRET is not set.",
		});
	});

	it("posts the request with the bearer secret and parses the answer", async () => {
		const seen: { url: string; init: RequestInit | undefined }[] = [];
		const fetcher = (async (url: URL, init?: RequestInit) => {
			seen.push({ url: String(url), init });
			return Response.json(SENT);
		}) as typeof fetch;

		expect(await apiSendPath(env, fetcher)(request)).toEqual(SENT);
		expect(seen[0]?.url).toBe("http://api.test/internal/sms/send");
		expect(new Headers(seen[0]?.init?.headers).get("authorization")).toBe(
			"Bearer s3cret",
		);
	});

	it("reads a non-2xx answer as unavailable", async () => {
		const fetcher = (async () =>
			new Response("nope", { status: 404 })) as unknown as typeof fetch;
		expect((await apiSendPath(env, fetcher)(request)).status).toBe(
			"unavailable",
		);
	});

	it("reads a network failure as unavailable", async () => {
		const fetcher = (async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;
		expect((await apiSendPath(env, fetcher)(request)).status).toBe(
			"unavailable",
		);
	});

	it("throws on an unreadable answer rather than guessing", async () => {
		const fetcher = (async () =>
			Response.json({ status: "sent" })) as unknown as typeof fetch;
		await expect(apiSendPath(env, fetcher)(request)).rejects.toThrow(
			/telnyxId/,
		);
	});
});

describe("explainHold", () => {
	it("states the reason, the retry time and not to resend", () => {
		const text = explainHold(
			"quiet-hours",
			new Date("2026-10-04T13:00:00.000Z"),
			"The send gate blocked it for quiet hours.",
		);
		expect(text).toContain("quiet hours");
		expect(text).toContain("2026-10-04T13:00:00.000Z");
		expect(text).toContain("Do not send it again.");
	});

	it("explains approval mode in a draft from deliver", async () => {
		const fake = fakeSms();
		const result = await deliver(REQUEST, {
			store: fake.store,
			sendPath: recordingPath(SENT).path,
			dryRun: true,
		});
		expect(result.status === "drafted" && result.detail).toContain(
			"Auto send is off",
		);
	});
});

describe("dryRunFrom", () => {
	it("is on unless DRY_RUN is exactly false", () => {
		expect(dryRunFrom({})).toBe(true);
		expect(dryRunFrom({ DRY_RUN: "true" })).toBe(true);
		expect(dryRunFrom({ DRY_RUN: "False" })).toBe(true);
		expect(dryRunFrom({ DRY_RUN: "false" })).toBe(false);
	});

	it("does not need the Telnyx key, which only the API holds", () => {
		expect(dryRunFrom({ DRY_RUN: "false", TELNYX_API_KEY: undefined })).toBe(
			false,
		);
	});
});
