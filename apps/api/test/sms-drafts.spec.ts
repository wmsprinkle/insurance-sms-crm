import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import { SmsDirection, SmsDraftStatus } from "@crm/db/enums";
import { OUTBOUND_GUARD } from "@crm/validation/outbound-guard";
import type { SmsSendRequest, SmsSendResponse } from "@crm/validation/sms-send";
import { z } from "zod";
import {
	guardRepText,
	heldAfterBlock,
	holdReasonLabel,
	sendOutcome,
} from "../src/sms/drafts";
import { SMS_DRAFTS } from "../src/sms/drafts.config";
import { SmsDraftsService } from "../src/sms/drafts.service";
import type { SmsInternalService } from "../src/sms/sms-internal.service";

const PHONE = "+12125550123";
const USER = "user-1";

type Draft = {
	id: string;
	contactId: string;
	body: string;
	reason: string;
	retryAt: Date | null;
	taskId: string | null;
	status: SmsDraftStatus;
	decidedAt: Date | null;
	decidedById: string | null;
	createdAt: Date;
	idempotencyKey?: string | null;
};

type Handoff = {
	id: string;
	contactId: string;
	reason: string;
	createdAt: Date;
	resolvedAt: Date | null;
};

type Task = {
	id: string;
	kind: string;
	contactId: string;
	payload: unknown;
	startedAt: Date | null;
	finishedAt: Date | null;
	reason?: string;
};

type Message = {
	id: string;
	contactId: string;
	direction: SmsDirection;
	createdAt: Date;
};

type Receipt = {
	id: string;
	contactId: string;
	type: string;
	taskId: string;
	purpose: string;
};

const inSet = z.object({ in: z.array(z.unknown()) });

function matches<T extends object>(row: T, where: Partial<T>): boolean {
	return (Object.keys(where) as (keyof T)[]).every((key) => {
		const set = inSet.safeParse(where[key]);
		return set.success
			? set.data.in.includes(row[key])
			: row[key] === where[key];
	});
}

function contactIds(value: string | { in: string[] }): string[] {
	const set = inSet.safeParse(value);
	return set.success ? (set.data.in as string[]) : [String(value)];
}

function draft(overrides: Partial<Draft> = {}): Draft {
	return {
		id: "draft-1",
		contactId: "contact-1",
		body: "Does Tuesday work for a quick call?",
		reason: "approval-mode",
		retryAt: null,
		taskId: "task-1",
		status: SmsDraftStatus.PENDING,
		decidedAt: null,
		decidedById: null,
		createdAt: new Date("2026-10-03T10:00:00Z"),
		...overrides,
	};
}

function fake(seed: {
	drafts?: Draft[];
	handoffs?: Handoff[];
	tasks?: Task[];
	messages?: Message[];
	sms?: unknown;
	suppressed?: string[];
	consented?: string[];
	events?: Receipt[];
}) {
	const state = {
		drafts: seed.drafts ?? [],
		handoffs: seed.handoffs ?? [],
		tasks: seed.tasks ?? [],
		messages: seed.messages ?? [],
		locks: [] as string[],
		suppressed: seed.suppressed ?? [],
		consented: seed.consented ?? [PHONE],
		events: seed.events ?? [],
	};
	const contact = {
		id: "contact-1",
		firstName: "Jane",
		lastName: "Doe",
		phone: PHONE,
		archivedAt: null,
	};
	const withContact = <T>(row: T) => ({ ...row, contact });

	const db = {
		smsDraft: {
			findUnique: async ({ where }: { where: { id: string } }) =>
				state.drafts.find((row) => row.id === where.id) ?? null,
			findMany: async ({ where }: { where: Partial<Draft> }) =>
				state.drafts.filter((row) => matches(row, where)).map(withContact),
			updateMany: async ({
				where,
				data,
			}: {
				where: Partial<Draft>;
				data: Partial<Draft>;
			}) => {
				const rows = state.drafts.filter((row) => matches(row, where));
				for (const row of rows) Object.assign(row, data);
				return { count: rows.length };
			},
		},
		smsHandoff: {
			findMany: async () =>
				state.handoffs.filter((row) => !row.resolvedAt).map(withContact),
			findUnique: async ({ where }: { where: { contactId: string } }) =>
				state.handoffs.find((row) => row.contactId === where.contactId) ?? null,
			updateMany: async ({
				where,
				data,
			}: {
				where: Partial<Handoff>;
				data: Partial<Handoff>;
			}) => {
				const rows = state.handoffs.filter((row) => matches(row, where));
				for (const row of rows) Object.assign(row, data);
				return { count: rows.length };
			},
		},
		contact: {
			findFirst: async ({ where }: { where: { id: string } }) =>
				where.id === contact.id ? contact : null,
		},
		smsMessage: {
			findMany: async ({
				where,
			}: {
				where: {
					contactId: string | { in: string[] };
					direction: SmsDirection;
					createdAt?: { gte: Date };
				};
			}) =>
				state.messages
					.filter(
						(row) =>
							(contactIds(where.contactId) as string[]).includes(
								row.contactId,
							) &&
							row.direction === where.direction &&
							(!where.createdAt || row.createdAt >= where.createdAt.gte),
					)
					.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
					.map((row) => ({ id: row.id, contactId: row.contactId })),
		},
		agentTask: {
			findFirst: async ({ where }: { where: Partial<Task> }) =>
				state.tasks.find((row) => matches(row, where)) ?? null,
			update: async ({
				where,
				data,
			}: {
				where: { id: string };
				data: Partial<Task>;
			}) => {
				const row = state.tasks.find((task) => task.id === where.id);
				if (row) Object.assign(row, data);
				return row;
			},
			create: async ({ data }: { data: Omit<Task, "id"> }) => {
				const row = {
					...data,
					id: `task-${state.tasks.length + 1}`,
					startedAt: null,
					finishedAt: null,
				};
				state.tasks.push(row);
				return row;
			},
		},
		appSetting: {
			findUnique: async () => ({ sms: seed.sms ?? null }),
		},
		phoneSuppression: {
			findUnique: async ({ where }: { where: { e164: string } }) =>
				state.suppressed.includes(where.e164) ? { e164: where.e164 } : null,
		},
		consentRecord: {
			findFirst: async ({ where }: { where: { e164: string } }) =>
				state.consented.includes(where.e164) ? { id: "consent-1" } : null,
		},
		agentEvent: {
			findUnique: async ({ where }: { where: { id: string } }) =>
				state.events.find((row) => row.id === where.id) ?? null,
			findMany: async ({
				where,
			}: {
				where: {
					contactId: string;
					type: { in: string[] };
					AND: [{ data: { equals: string } }, unknown];
				};
			}) =>
				state.events.filter(
					(row) =>
						row.contactId === where.contactId &&
						where.type.in.includes(row.type) &&
						row.taskId === where.AND[0].data.equals &&
						["conversation", "first-touch"].includes(row.purpose),
				),
		},
		$queryRaw: async (_strings: TemplateStringsArray, key: string) => {
			state.locks.push(key);
			return [{ locked: false }];
		},
		$transaction: async <T>(work: (tx: never) => Promise<T>) =>
			work(db as never),
	};
	return { state, db };
}

function scriptedSender(responses: SmsSendResponse[]) {
	const calls: SmsSendRequest[] = [];
	const sender = {
		send: async (request: SmsSendRequest) => {
			calls.push(request);
			const next = responses.shift();
			if (!next) throw new Error("No scripted response left");
			return next;
		},
	} as unknown as SmsInternalService;
	return { calls, sender };
}

function service(
	seed: Parameters<typeof fake>[0],
	responses: SmsSendResponse[] = [],
) {
	const { state, db } = fake(seed);
	const { calls, sender } = scriptedSender(responses);
	return {
		state,
		calls,
		drafts: new SmsDraftsService(db as unknown as Db, sender),
	};
}

const SENT: SmsSendResponse = { status: "sent", telnyxId: "m1", dryRun: true };

describe("drafts helpers", () => {
	it("labels known hold reasons and keeps unknown ones", () => {
		expect(holdReasonLabel("quiet-hours")).toContain("quiet hours");
		expect(holdReasonLabel("something-else")).toBe("something-else");
	});

	it("passes clean rep text and suggests a sanitized version otherwise", () => {
		expect(guardRepText("Talk soon!", "disclose")).toEqual({
			ok: true,
			text: "Talk soon!",
		});
		expect(guardRepText("Call me at 212-555-0123 today", "disclose")).toEqual({
			ok: false,
			outcome: {
				status: "guarded",
				reason: "sanitized",
				suggestion: "Call me at today",
			},
		});
		expect(guardRepText("As an AI I cannot say", "disclose")).toEqual({
			ok: false,
			outcome: {
				status: "guarded",
				reason: "breaks_character",
				suggestion: OUTBOUND_GUARD.safeFallback,
			},
		});
	});

	it("maps send responses and holds only quiet-hours blocks", () => {
		expect(sendOutcome(SENT)).toEqual({ status: "sent", dryRun: true });
		const quiet = sendOutcome({
			status: "blocked",
			reason: "quiet-hours",
			retryAt: "2026-10-04T13:00:00.000Z",
		});
		expect(heldAfterBlock(quiet)).toEqual({
			reason: "quiet-hours",
			retryAt: new Date("2026-10-04T13:00:00.000Z"),
		});
		expect(
			heldAfterBlock({
				status: "blocked",
				reason: "suppressed",
				retryAt: null,
			}),
		).toBeNull();
	});
});

describe("SmsDraftsService.queue", () => {
	it("lists pending drafts with contact, reason label and handoff flag", async () => {
		const { drafts } = service({
			drafts: [
				draft(),
				draft({ id: "draft-2", status: SmsDraftStatus.DISCARDED }),
			],
			handoffs: [
				{
					id: "h1",
					contactId: "contact-1",
					reason: "claim question",
					createdAt: new Date("2026-10-03T09:00:00Z"),
					resolvedAt: null,
				},
			],
		});
		const queue = await drafts.queue();
		expect(queue.drafts).toHaveLength(1);
		expect(queue.drafts[0]).toMatchObject({
			id: "draft-1",
			name: "Jane Doe",
			phone: PHONE,
			reason: "approval-mode",
			handedOff: true,
		});
		expect(queue.handoffs).toEqual([
			{
				id: "h1",
				contactId: "contact-1",
				name: "Jane Doe",
				phone: PHONE,
				reason: "claim question",
				createdAt: "2026-10-03T09:00:00.000Z",
			},
		]);
		expect(queue.truncated).toBe(false);
	});
});

describe("SmsDraftsService.approve", () => {
	it("sends the draft with a new idempotency key and records the decision", async () => {
		const { drafts, calls, state } = service({ drafts: [draft()] }, [SENT]);
		const outcome = await drafts.approve({ draftId: "draft-1" }, USER);

		expect(outcome).toEqual({ status: "sent", dryRun: true });
		expect(calls).toEqual([
			{
				contactId: "contact-1",
				to: PHONE,
				text: "Does Tuesday work for a quick call?",
				purpose: "conversation",
				idempotencyKey: `${SMS_DRAFTS.idempotency.draftPrefix}draft-1`,
				taskId: "task-1",
				dryRun: false,
			},
		]);
		expect(state.drafts[0]).toMatchObject({
			status: SmsDraftStatus.APPROVED,
			decidedById: USER,
		});
		expect(state.drafts[0]?.decidedAt).toBeInstanceOf(Date);
	});

	it("sends edited text and stores it on the draft", async () => {
		const { drafts, calls, state } = service({ drafts: [draft()] }, [SENT]);
		await drafts.approve({ draftId: "draft-1", text: "Wednesday then?" }, USER);
		expect(calls[0]?.text).toBe("Wednesday then?");
		expect(state.drafts[0]?.body).toBe("Wednesday then?");
	});

	it("re-runs the guard on edited text and sends nothing when it fails", async () => {
		const { drafts, calls, state } = service({ drafts: [draft()] });
		const outcome = await drafts.approve(
			{ draftId: "draft-1", text: "Email me at rep@agency.com" },
			USER,
		);
		expect(outcome).toEqual({
			status: "guarded",
			reason: "sanitized",
			suggestion: "Email me at",
		});
		expect(calls).toHaveLength(0);
		expect(state.drafts[0]?.status).toBe(SmsDraftStatus.PENDING);
	});

	it("uses the disclosure mode from settings for edited text", async () => {
		const text = "I'm an automated assistant for the agency.";
		const deflect = service(
			{ drafts: [draft()], sms: { disclosureMode: "deflect" } },
			[SENT],
		);
		expect(
			(await deflect.drafts.approve({ draftId: "draft-1", text }, USER)).status,
		).toBe("guarded");

		const disclose = service({ drafts: [draft()] }, [SENT]);
		expect(
			(await disclose.drafts.approve({ draftId: "draft-1", text }, USER))
				.status,
		).toBe("sent");
	});

	it("keeps the draft pending with the retry time when quiet hours block it", async () => {
		const { drafts, state } = service({ drafts: [draft()] }, [
			{
				status: "blocked",
				reason: "quiet-hours",
				retryAt: "2026-10-04T13:00:00.000Z",
			},
		]);
		const outcome = await drafts.approve({ draftId: "draft-1" }, USER);
		expect(outcome).toEqual({
			status: "blocked",
			reason: "quiet-hours",
			retryAt: "2026-10-04T13:00:00.000Z",
		});
		expect(state.drafts[0]).toMatchObject({
			status: SmsDraftStatus.PENDING,
			reason: "quiet-hours",
			retryAt: new Date("2026-10-04T13:00:00.000Z"),
			decidedAt: null,
		});
	});

	it("keeps the draft pending and its reason when consent or suppression blocks it", async () => {
		const { drafts, state } = service({ drafts: [draft()] }, [
			{ status: "blocked", reason: "no-consent", retryAt: null },
		]);
		expect((await drafts.approve({ draftId: "draft-1" }, USER)).status).toBe(
			"blocked",
		);
		expect(state.drafts[0]).toMatchObject({
			status: SmsDraftStatus.PENDING,
			reason: "approval-mode",
		});
	});

	it("refuses a draft that is no longer pending", async () => {
		const { drafts, calls } = service({
			drafts: [draft({ status: SmsDraftStatus.APPROVED })],
		});
		expect(await drafts.approve({ draftId: "draft-1" }, USER)).toEqual({
			status: "failed",
			error: SMS_DRAFTS.errors.gone,
		});
		expect(calls).toHaveLength(0);
	});
});

describe("SmsDraftsService.discard", () => {
	it("discards a pending draft once", async () => {
		const { drafts, state } = service({ drafts: [draft()] });
		expect(await drafts.discard({ draftId: "draft-1" }, USER)).toEqual({
			discarded: true,
		});
		expect(state.drafts[0]).toMatchObject({
			status: SmsDraftStatus.DISCARDED,
			decidedById: USER,
		});
		expect(await drafts.discard({ draftId: "draft-1" }, USER)).toEqual({
			discarded: false,
		});
	});
});

describe("SmsDraftsService.compose", () => {
	it("sends rep text through the gate with a compose key", async () => {
		const { drafts, calls } = service({}, [SENT]);
		const outcome = await drafts.compose({
			contactId: "contact-1",
			text: "Hi Jane, checking in.",
			idempotencyKey: "ui-key-12345",
		});
		expect(outcome.status).toBe("sent");
		expect(calls[0]).toMatchObject({
			to: PHONE,
			idempotencyKey: `${SMS_DRAFTS.idempotency.composePrefix}ui-key-12345`,
			taskId: null,
		});
	});

	it("fails for a contact without a phone", async () => {
		const { drafts } = service({});
		expect(
			await drafts.compose({
				contactId: "nobody",
				text: "Hi",
				idempotencyKey: "ui-key-12345",
			}),
		).toEqual({ status: "failed", error: SMS_DRAFTS.errors.noPhone });
	});
});

describe("SmsDraftsService.handBack", () => {
	const handoff: Handoff = {
		id: "h1",
		contactId: "contact-1",
		reason: "claim",
		createdAt: new Date("2026-10-03T09:00:00Z"),
		resolvedAt: null,
	};
	const messages: Message[] = [
		{
			id: "old",
			contactId: "contact-1",
			direction: SmsDirection.INBOUND,
			createdAt: new Date("2026-10-03T08:00:00Z"),
		},
		{
			id: "in-1",
			contactId: "contact-1",
			direction: SmsDirection.INBOUND,
			createdAt: new Date("2026-10-03T09:05:00Z"),
		},
		{
			id: "out-1",
			contactId: "contact-1",
			direction: SmsDirection.OUTBOUND,
			createdAt: new Date("2026-10-03T09:06:00Z"),
		},
		{
			id: "in-2",
			contactId: "contact-1",
			direction: SmsDirection.INBOUND,
			createdAt: new Date("2026-10-03T09:10:00Z"),
		},
	];

	it("resolves the handoff and queues an sms-reply task for replies since it", async () => {
		const { drafts, state } = service({
			handoffs: [{ ...handoff }],
			messages,
		});
		expect(await drafts.handBack({ contactId: "contact-1" })).toEqual({
			resolved: true,
			queued: true,
		});
		expect(state.handoffs[0]?.resolvedAt).toBeInstanceOf(Date);
		expect(state.locks).toEqual(["agent-task:sms-reply:contact-1"]);
		expect(state.tasks).toHaveLength(1);
		expect(state.tasks[0]).toMatchObject({
			kind: "sms-reply",
			contactId: "contact-1",
			payload: {
				type: "sms.received",
				smsMessageIds: ["in-1", "in-2"],
				from: PHONE,
			},
		});
	});

	it("folds the replies into a pending sms-reply task", async () => {
		const { drafts, state } = service({
			handoffs: [{ ...handoff }],
			messages,
			tasks: [
				{
					id: "t1",
					kind: "sms-reply",
					contactId: "contact-1",
					startedAt: null,
					finishedAt: null,
					payload: {
						type: "sms.received",
						smsMessageIds: ["in-1"],
						from: PHONE,
					},
				},
			],
		});
		await drafts.handBack({ contactId: "contact-1" });
		expect(state.tasks).toHaveLength(1);
		expect(state.tasks[0]?.payload).toEqual({
			type: "sms.received",
			smsMessageIds: ["in-1", "in-2"],
			from: PHONE,
		});
	});

	it("resolves without a task when the lead sent nothing since the handoff", async () => {
		const { drafts, state } = service({
			handoffs: [{ ...handoff }],
			messages: messages.slice(0, 1),
		});
		expect(await drafts.handBack({ contactId: "contact-1" })).toEqual({
			resolved: true,
			queued: false,
		});
		expect(state.tasks).toHaveLength(0);
	});

	it("does nothing when no open handoff exists", async () => {
		const { drafts, state } = service({
			handoffs: [{ ...handoff, resolvedAt: new Date() }],
			messages,
		});
		expect(await drafts.handBack({ contactId: "contact-1" })).toEqual({
			resolved: false,
			queued: false,
		});
		expect(state.tasks).toHaveLength(0);
	});
});

describe("SmsDraftsService.approve after an uncertain agent send", () => {
	const receipt = (type: string, purpose = "conversation") => ({
		id: "sms-send:agent-key-1",
		contactId: "contact-1",
		type,
		taskId: "task-1",
		purpose,
	});

	it("discards a keyed draft whose original key already sent, and sends nothing", async () => {
		const { drafts, calls, state } = service({
			drafts: [draft({ idempotencyKey: "agent-key-1" })],
			events: [receipt("sms.send.sent")],
		});

		expect(await drafts.approve({ draftId: "draft-1" }, USER)).toEqual({
			status: "failed",
			error: SMS_DRAFTS.errors.alreadySent,
		});
		expect(calls).toHaveLength(0);
		expect(state.drafts[0]?.status).toBe(SmsDraftStatus.DISCARDED);
	});

	it("waits while the original keyed send is still claimed", async () => {
		const { drafts, calls, state } = service({
			drafts: [draft({ idempotencyKey: "agent-key-1" })],
			events: [receipt("sms.send.claimed")],
		});

		expect(await drafts.approve({ draftId: "draft-1" }, USER)).toEqual({
			status: "failed",
			error: SMS_DRAFTS.errors.inProgress,
		});
		expect(calls).toHaveLength(0);
		expect(state.drafts[0]?.status).toBe(SmsDraftStatus.PENDING);
	});

	it("checks the task's receipts for a no-send-path draft without a key", async () => {
		const { drafts, calls } = service({
			drafts: [draft({ reason: "no-send-path" })],
			events: [{ ...receipt("sms.send.sent"), id: "sms-send:other-key" }],
		});

		expect(await drafts.approve({ draftId: "draft-1" }, USER)).toMatchObject({
			error: SMS_DRAFTS.errors.alreadySent,
		});
		expect(calls).toHaveLength(0);
	});

	it("ignores a handoff receipt of the same task", async () => {
		const { drafts, calls } = service(
			{
				drafts: [draft({ reason: "send-failed" })],
				events: [receipt("sms.send.sent", "handoff")],
			},
			[SENT],
		);

		expect(await drafts.approve({ draftId: "draft-1" }, USER)).toMatchObject({
			status: "sent",
		});
		expect(calls).toHaveLength(1);
	});

	it("does not look up receipts for an approval-mode draft", async () => {
		const { drafts, calls } = service(
			{ drafts: [draft()], events: [receipt("sms.send.sent")] },
			[SENT],
		);

		expect(await drafts.approve({ draftId: "draft-1" }, USER)).toMatchObject({
			status: "sent",
		});
		expect(calls).toHaveLength(1);
	});
});

describe("SmsDraftsService.handBack on an opted-out contact", () => {
	const handoff = {
		id: "handoff-1",
		contactId: "contact-1",
		reason: "claim",
		createdAt: new Date("2026-10-03T09:00:00Z"),
		resolvedAt: null,
	};
	const reply = {
		id: "sms-in-1",
		contactId: "contact-1",
		direction: SmsDirection.INBOUND,
		createdAt: new Date("2026-10-03T09:30:00Z"),
	};

	it("resolves the handoff but queues no agent reply for a suppressed number", async () => {
		const { drafts, state } = service({
			handoffs: [{ ...handoff }],
			messages: [reply],
			suppressed: [PHONE],
		});

		expect(await drafts.handBack({ contactId: "contact-1" })).toEqual({
			resolved: true,
			queued: false,
		});
		expect(state.tasks).toHaveLength(0);
	});

	it("queues no agent reply when consent for this phone is gone", async () => {
		const { drafts, state } = service({
			handoffs: [{ ...handoff }],
			messages: [reply],
			consented: [],
		});

		expect(await drafts.handBack({ contactId: "contact-1" })).toEqual({
			resolved: true,
			queued: false,
		});
		expect(state.tasks).toHaveLength(0);
	});
});

describe("SmsDraftsService.approve send key", () => {
	it("sends with the agent's original key when the draft has one", async () => {
		const { drafts, calls } = service(
			{ drafts: [draft({ idempotencyKey: "send_sms:task-1" })] },
			[SENT],
		);

		await drafts.approve({ draftId: "draft-1" }, USER);

		expect(calls[0]?.idempotencyKey).toBe("send_sms:task-1");
	});

	it("falls back to the draft key for a draft without one", async () => {
		const { drafts, calls } = service({ drafts: [draft()] }, [SENT]);

		await drafts.approve({ draftId: "draft-1" }, USER);

		expect(calls[0]?.idempotencyKey).toBe(
			`${SMS_DRAFTS.idempotency.draftPrefix}draft-1`,
		);
	});
});

describe("SmsDraftsService.queue first messages", () => {
	it("flags a draft to a lead who has not replied", async () => {
		const { drafts } = service({
			drafts: [draft({ id: "d1", contactId: "contact-1" })],
		});
		expect((await drafts.queue()).drafts[0]?.firstMessage).toBe(true);
	});

	it("does not flag a reply draft", async () => {
		const { drafts } = service({
			drafts: [draft({ id: "d1", contactId: "contact-1" })],
			messages: [
				{
					id: "m1",
					contactId: "contact-1",
					direction: SmsDirection.INBOUND,
					createdAt: new Date("2026-10-03T09:00:00Z"),
				},
			],
		});
		expect((await drafts.queue()).drafts[0]?.firstMessage).toBe(false);
	});
});

describe("SmsDraftsService bulk", () => {
	const two = () => [
		draft({ id: "d1", body: "Hello Jane, Are you interested?" }),
		draft({ id: "d2", body: "Hello Jane, Are you interested?" }),
	];

	it("sends each draft through the same gate and reports each outcome", async () => {
		const { drafts, calls, state } = service({ drafts: two() }, [
			SENT,
			{ status: "blocked", reason: "quiet-hours", retryAt: null },
		]);

		const result = await drafts.approveAll({ draftIds: ["d1", "d2"] }, USER);

		expect(calls).toHaveLength(2);
		expect(result.items.map((item) => item.outcome.status)).toEqual([
			"sent",
			"blocked",
		]);
		expect(result.items[0]?.name).toBe("Jane Doe");
		expect(state.drafts[0]?.status).toBe(SmsDraftStatus.APPROVED);
		expect(state.drafts[1]?.status).toBe(SmsDraftStatus.PENDING);
	});

	it("reports a draft that is no longer pending without sending it", async () => {
		const { drafts, calls } = service({
			drafts: [draft({ id: "d1", status: SmsDraftStatus.DISCARDED })],
		});

		const result = await drafts.approveAll({ draftIds: ["d1", "d1"] }, USER);

		expect(calls).toHaveLength(0);
		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.outcome).toEqual({
			status: "failed",
			error: SMS_DRAFTS.errors.gone,
		});
	});

	it("discards only the pending drafts it was given", async () => {
		const { drafts, state } = service({
			drafts: [
				...two(),
				draft({ id: "d3" }),
				draft({ id: "d4", status: SmsDraftStatus.APPROVED }),
			],
		});

		const result = await drafts.discardAll(
			{ draftIds: ["d1", "d2", "d4"] },
			USER,
		);

		expect(result).toEqual({ discarded: 2 });
		expect(state.drafts.map((row) => row.status)).toEqual([
			SmsDraftStatus.DISCARDED,
			SmsDraftStatus.DISCARDED,
			SmsDraftStatus.PENDING,
			SmsDraftStatus.APPROVED,
		]);
	});
});
