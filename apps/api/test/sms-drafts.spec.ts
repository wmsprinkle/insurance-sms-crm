import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import { SmsDirection, SmsDraftStatus } from "@crm/db/enums";
import { OUTBOUND_GUARD } from "@crm/validation/outbound-guard";
import type { SmsSendRequest, SmsSendResponse } from "@crm/validation/sms-send";
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

function matches<T extends object>(row: T, where: Partial<T>): boolean {
	return (Object.keys(where) as (keyof T)[]).every(
		(key) => row[key] === where[key],
	);
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
}) {
	const state = {
		drafts: seed.drafts ?? [],
		handoffs: seed.handoffs ?? [],
		tasks: seed.tasks ?? [],
		messages: seed.messages ?? [],
		locks: [] as string[],
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
					contactId: string;
					direction: SmsDirection;
					createdAt: { gte: Date };
				};
			}) =>
				state.messages
					.filter(
						(row) =>
							row.contactId === where.contactId &&
							row.direction === where.direction &&
							row.createdAt >= where.createdAt.gte,
					)
					.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
					.map((row) => ({ id: row.id })),
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
