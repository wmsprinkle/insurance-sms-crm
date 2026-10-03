import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import { SmsStatus } from "@crm/db/enums";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { SmsService } from "../src/sms/sms.service";
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
	return {
		state,
		drained: () => drained,
		sms: new SmsService(
			db as unknown as Db,
			agents as unknown as AgentTriggerService,
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
