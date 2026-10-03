import { describe, expect, it } from "bun:test";
import { judgeAttempt } from "../agent/lib/approval-sms";
import { SMS_AGENT } from "../agent/lib/sms-config";
import { type DeliveryRequest, deliver } from "../agent/lib/sms-delivery";
import { optOutKey, optOutLead } from "../agent/lib/sms-opt-out";
import { apiSendPath } from "../agent/lib/sms-outbound";
import { fakeSms, LEAD, recordingPath } from "./support/sms-fakes";

const SENT = { status: "sent", telnyxId: "tx-1", dryRun: true } as const;

const REPLY: DeliveryRequest = {
	contactId: LEAD.id,
	text: "Which state do you live in?",
	purpose: "conversation",
	taskId: "t1",
	idempotencyKey: `${SMS_AGENT.keys.reply}t1`,
	bookingLink: null,
	oncePerKey: true,
};

describe("H5: a bridge timeout is unknown, not unsent", () => {
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

	it("reads a timeout as unknown", async () => {
		const fetcher = (async () => {
			throw new DOMException("timed out", "TimeoutError");
		}) as unknown as typeof fetch;

		expect((await apiSendPath(env, fetcher)(request)).status).toBe("unknown");
	});

	it("waits longer than the API's Telnyx timeout plus a rate-limit wait", () => {
		expect(SMS_AGENT.bridge.timeoutMs).toBeGreaterThan(30_000);
	});

	it("drafts an unknown send with the original key so approval replays it", async () => {
		const fake = fakeSms({ autoSend: true });
		const path = recordingPath({ status: "unknown", reason: "timed out" });

		const delivery = await deliver(REPLY, {
			...fake,
			sendPath: path.path,
			dryRun: true,
		});

		expect(delivery.status).toBe("drafted");
		expect(fake.drafts[0]?.idempotencyKey).toBe(REPLY.idempotencyKey);
		expect(judgeAttempt({ status: "unknown", reason: "x" }).kind).toBe("hold");
	});

	it("stores the key on an approval-mode draft too", async () => {
		const fake = fakeSms();
		const path = recordingPath(SENT);

		await deliver(REPLY, { ...fake, sendPath: path.path, dryRun: true });

		expect(path.calls).toHaveLength(0);
		expect(fake.drafts[0]?.idempotencyKey).toBe(REPLY.idempotencyKey);
	});
});

describe("M2: one model reply per task", () => {
	it("refuses a second send_sms in the same task", async () => {
		const fake = fakeSms({ autoSend: true });
		const path = recordingPath(SENT);
		const deps = { ...fake, sendPath: path.path, dryRun: true };

		expect((await deliver(REPLY, deps)).status).toBe("sent");
		fake.receipts.add(REPLY.idempotencyKey);
		const second = await deliver(
			{ ...REPLY, text: "Also, are you over 18?" },
			deps,
		);

		expect(second).toEqual({
			status: "refused",
			reason: SMS_AGENT.next.alreadyReplied,
		});
		expect(path.calls).toHaveLength(1);
	});

	it("refuses a second reply after the first became a draft", async () => {
		const fake = fakeSms();
		const path = recordingPath(SENT);
		const deps = { ...fake, sendPath: path.path, dryRun: true };

		await deliver(REPLY, deps);
		const second = await deliver(REPLY, deps);

		expect(second.status).toBe("refused");
		expect(fake.drafts).toHaveLength(1);
	});
});

describe("H1/H2: opt-out runs once and confirms once", () => {
	it("suppresses, moves the deal and sends one confirmation with a stable key", async () => {
		const fake = fakeSms();
		const path = recordingPath(SENT);

		const outcome = await optOutLead(
			{ contactId: LEAD.id, reason: "opt_out", taskId: "t1" },
			{ ...fake, sendPath: path.path, dryRun: true },
		);

		expect(outcome).toMatchObject({
			ok: true,
			alreadySuppressed: false,
			confirmation: "sent",
		});
		expect(fake.optOuts).toHaveLength(1);
		expect(fake.stages).toEqual([
			{ contactId: LEAD.id, stage: "UNQUALIFIED_TO_BUY" },
		]);
		expect(path.calls).toHaveLength(1);
		expect(path.calls[0]?.purpose).toBe("opt-out-confirmation");
		expect(path.calls[0]?.idempotencyKey).toBe(
			optOutKey(LEAD.phone, fake.suppressed.get(LEAD.phone) ?? new Date(0)),
		);
	});

	it("sends no second confirmation to a number already suppressed", async () => {
		const fake = fakeSms();
		const path = recordingPath(SENT);
		const deps = { ...fake, sendPath: path.path, dryRun: true };

		await optOutLead(
			{ contactId: LEAD.id, reason: "opt_out", taskId: "t1" },
			deps,
		);
		const again = await optOutLead(
			{ contactId: LEAD.id, reason: "opt_out", taskId: "t2" },
			deps,
		);

		expect(again).toMatchObject({
			ok: true,
			alreadySuppressed: true,
			confirmation: "skipped",
		});
		expect(path.calls).toHaveLength(1);
	});

	it("refuses a contact with no phone", async () => {
		const fake = fakeSms();
		fake.contacts.set(LEAD.id, { ...LEAD, phone: null });
		const path = recordingPath(SENT);

		const outcome = await optOutLead(
			{ contactId: LEAD.id, reason: "wrong_number", taskId: null },
			{ ...fake, sendPath: path.path, dryRun: true },
		);

		expect(outcome.ok).toBe(false);
		expect(path.calls).toHaveLength(0);
	});
});
