import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import { SmsStatus } from "@crm/db/enums";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { ConsentService } from "../src/compliance/consent.service";
import { SendGateService } from "../src/compliance/send-gate";
import { SuppressionService } from "../src/compliance/suppression.service";
import { KeywordService } from "../src/sms/keyword.service";
import { RateLimiter } from "../src/sms/rate-limiter";
import { SmsService } from "../src/sms/sms.service";
import { SmsSender } from "../src/sms/sms-sender.service";
import { TelnyxClient } from "../src/sms/telnyx.client";
import type { TelnyxInbound } from "../src/sms/telnyx-event";
import { fakeDb } from "./support/sms-db";

const CONTACT = { id: "contact-1", phone: "+15125550123", archivedAt: null };

function inbound(overrides: Partial<TelnyxInbound> = {}): TelnyxInbound {
	return {
		kind: "received",
		eventId: "evt-1",
		telnyxId: "in-1",
		from: "+15125550123",
		to: "+18005550100",
		text: "What does it cost?",
		...overrides,
	};
}

function service(seed: Parameters<typeof fakeDb>[0] = {}) {
	const { state, db } = fakeDb({ contacts: [CONTACT], ...seed });
	let drained = 0;
	const agents = { drainQueues: () => (drained += 1) };
	const client = db as unknown as Db;
	const consent = new ConsentService(client);
	const suppression = new SuppressionService(client);
	const telnyx = new TelnyxClient(
		{
			apiKey: null,
			publicKey: null,
			messagingProfileId: null,
			fromNumber: "+18005550100",
			messagesPerSecond: null,
			dryRun: true,
		},
		new RateLimiter(10, 10, { now: () => 0, sleep: async () => undefined }),
	);
	const gate = new SendGateService(client, consent, suppression);
	const sender = new SmsSender(client, gate, telnyx);
	return {
		state,
		gate,
		drained: () => drained,
		sms: new SmsService(
			client,
			agents as unknown as AgentTriggerService,
			new KeywordService(client, consent, suppression, sender),
		),
	};
}

describe("SmsService.receive", () => {
	it("stores the message and queues one sms-reply task", async () => {
		const { sms, state, drained } = service();

		expect(await sms.receive(inbound())).toBe("stored");

		expect(state.sms).toMatchObject([
			{
				contactId: "contact-1",
				direction: "INBOUND",
				telnyxId: "in-1",
				status: SmsStatus.RECEIVED,
			},
		]);
		expect(state.tasks).toMatchObject([
			{
				contactId: "contact-1",
				kind: "sms-reply",
				payload: {
					type: "sms.received",
					smsMessageIds: [state.sms[0]?.id],
					from: "+15125550123",
				},
			},
		]);
		expect(drained()).toBe(1);
	});

	it("treats a Telnyx retry as a duplicate and queues nothing new", async () => {
		const { sms, state } = service();

		await sms.receive(inbound());
		expect(await sms.receive(inbound())).toBe("duplicate");

		expect(state.sms).toHaveLength(1);
		expect(state.tasks).toHaveLength(1);
	});

	it("folds a second message into the task the agent has not started", async () => {
		const { sms, state } = service();

		await sms.receive(inbound({ telnyxId: "in-1" }));
		await sms.receive(inbound({ telnyxId: "in-2", text: "Hello?" }));

		expect(state.tasks).toHaveLength(1);
		expect(state.tasks[0]?.payload).toMatchObject({
			smsMessageIds: [state.sms[0]?.id, state.sms[1]?.id],
		});
	});

	it("queues a new task when the agent already started the last one", async () => {
		const { sms, state } = service();

		await sms.receive(inbound({ telnyxId: "in-1" }));
		const first = state.tasks[0];
		if (first) first.startedAt = new Date();
		await sms.receive(inbound({ telnyxId: "in-2" }));

		expect(state.tasks).toHaveLength(2);
	});

	it("drops a message from a number no active contact has", async () => {
		const { sms, state } = service({
			contacts: [{ ...CONTACT, archivedAt: new Date() }],
		});

		expect(await sms.receive(inbound())).toBe("unknown-sender");
		expect(state.sms).toHaveLength(0);
		expect(state.tasks).toHaveLength(0);
	});

	it("normalises the sender before matching", async () => {
		const { sms } = service();
		expect(await sms.receive(inbound({ from: "(512) 555-0123" }))).toBe(
			"stored",
		);
		expect(await sms.receive(inbound({ from: "short" }))).toBe(
			"invalid-sender",
		);
	});
});

describe("SmsService.updateStatus", () => {
	it("moves a message forward and never back", async () => {
		const { sms, state } = service();
		state.sms.push({
			id: "out-1",
			contactId: "contact-1",
			direction: "OUTBOUND",
			body: "Hi",
			telnyxId: "msg-1",
			status: SmsStatus.SENDING,
			errorCode: null,
		});

		const update = {
			kind: "status" as const,
			eventId: "evt",
			telnyxId: "msg-1",
			errorCode: null,
		};

		expect(
			await sms.updateStatus({ ...update, status: SmsStatus.DELIVERED }),
		).toBe("updated");
		expect(await sms.updateStatus({ ...update, status: SmsStatus.SENT })).toBe(
			"unchanged",
		);
		expect(state.sms[0]?.status).toBe(SmsStatus.DELIVERED);
	});
});

describe("SmsService.receive keywords", () => {
	const consented = () => ({
		consents: [
			{ id: "c1", contactId: "contact-1", source: "WEB_FORM", revokedAt: null },
		],
	});

	it("STOP suppresses the number, revokes consent, pauses tasks and confirms", async () => {
		const { sms, state, drained } = service({
			...consented(),
			workspaceName: "Acme Insurance",
			tasks: [
				{
					id: "t1",
					contactId: "contact-1",
					kind: "first-touch",
					reason: "New lead",
					payload: null,
					startedAt: null,
					finishedAt: null,
					outcome: null,
				},
			],
		});

		expect(await sms.receive(inbound({ text: " stop. " }))).toBe(
			"keyword-stop",
		);

		expect(state.suppressions).toEqual([
			{ e164: "+15125550123", reason: "STOP_KEYWORD" },
		]);
		expect(state.consents[0]?.revokedAt).toBeInstanceOf(Date);
		expect(state.tasks[0]).toMatchObject({ outcome: "opted-out" });
		expect(state.tasks.some((task) => task.kind === "sms-reply")).toBe(false);
		expect(drained()).toBe(0);
		expect(state.sms.map((row) => row.direction)).toEqual([
			"INBOUND",
			"OUTBOUND",
		]);
		expect(state.sms[1]?.body).toStartWith(
			"Acme Insurance: You are unsubscribed",
		);
		expect(state.events).toMatchObject([
			{ type: "sms.send.allowed", data: { reason: "keyword-reply" } },
		]);
	});

	it("blocks ordinary sends after STOP", async () => {
		const { sms, gate } = service(consented());
		await sms.receive(inbound({ text: "UNSUBSCRIBE" }));

		await expect(
			gate.check({
				to: "+15125550123",
				contactId: "contact-1",
				purpose: "conversation",
				now: new Date("2026-10-05T17:00:00Z"),
			}),
		).resolves.toMatchObject({ allowed: false, reason: "suppressed" });
	});

	it("does not re-run STOP for a Telnyx retry", async () => {
		const { sms, state } = service(consented());

		await sms.receive(inbound({ text: "STOP" }));
		expect(await sms.receive(inbound({ text: "STOP" }))).toBe("duplicate");

		expect(
			state.sms.filter((row) => row.direction === "OUTBOUND"),
		).toHaveLength(1);
	});

	it("STOP from an unknown number still suppresses it", async () => {
		const { sms, state } = service({ contacts: [] });

		expect(
			await sms.receive(inbound({ from: "+13055550199", text: "quit" })),
		).toBe("keyword-stop");

		expect(state.suppressions).toEqual([
			{ e164: "+13055550199", reason: "STOP_KEYWORD" },
		]);
		expect(state.sms).toHaveLength(0);
	});

	it("does not re-run a keyword from an unknown number on a Telnyx retry", async () => {
		const { sms, state } = service({ contacts: [] });
		const stop = inbound({ from: "+13055550199", text: "STOP" });

		expect(await sms.receive(stop)).toBe("keyword-stop");
		expect(await sms.receive(stop)).toBe("duplicate");

		const receipts = state.events.filter(
			(event) => event.sessionId === "sms:keyword",
		);
		expect(receipts).toEqual([
			{
				id: "sms-keyword:in-1",
				sessionId: "sms:keyword",
				contactId: null,
				type: "sms.keyword.received",
				data: { from: "+13055550199", keyword: "stop", telnyxId: "in-1" },
				emittedAt: expect.any(Date),
			},
		]);
		expect(
			state.events.filter((event) => event.type === "sms.send.allowed"),
		).toHaveLength(1);
	});

	it("answers HELP from an unknown number once per Telnyx message", async () => {
		const { sms, state } = service({ contacts: [] });
		const help = inbound({ from: "+13055550199", text: "HELP" });

		await sms.receive(help);
		expect(await sms.receive(help)).toBe("duplicate");
		expect(await sms.receive(inbound({ ...help, telnyxId: "in-2" }))).toBe(
			"keyword-help",
		);

		expect(
			state.events.filter((event) => event.type === "sms.send.allowed"),
		).toHaveLength(2);
	});

	it("START lifts a STOP suppression and records SMS consent", async () => {
		const { sms, state } = service({
			suppressions: [{ e164: "+15125550123", reason: "STOP_KEYWORD" }],
		});

		expect(await sms.receive(inbound({ text: "Start" }))).toBe("keyword-start");

		expect(state.suppressions).toHaveLength(0);
		expect(state.consents).toMatchObject([
			{ contactId: "contact-1", source: "SMS_KEYWORD", revokedAt: null },
		]);
	});

	it("START does not lift a suppression a rep set by hand", async () => {
		const { sms, state } = service({
			suppressions: [{ e164: "+15125550123", reason: "MANUAL" }],
		});

		await sms.receive(inbound({ text: "UNSTOP" }));

		expect(state.suppressions).toHaveLength(1);
	});

	it("HELP replies without changing consent or suppression", async () => {
		const { sms, state } = service(consented());

		expect(await sms.receive(inbound({ text: "help" }))).toBe("keyword-help");

		expect(state.suppressions).toHaveLength(0);
		expect(state.consents[0]?.revokedAt).toBeNull();
		expect(state.sms[1]?.body).toContain("Reply STOP to unsubscribe");
		expect(state.tasks).toHaveLength(0);
	});
});
