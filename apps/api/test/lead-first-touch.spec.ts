import { describe, expect, it } from "bun:test";
import type { Db, Prisma } from "@crm/db";
import { RecordSource } from "@crm/db/enums";
import { parseFirstTouchTaskPayload } from "@crm/validation/first-touch-task";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { ConsentService } from "../src/compliance/consent.service";
import { nextSendWindow, sendWindowFor } from "../src/compliance/quiet-hours";
import { SuppressionService } from "../src/compliance/suppression.service";
import { planFirstTouch } from "../src/leads/first-touch";
import { FirstTouchService } from "../src/leads/first-touch.service";
import { LeadWriterService } from "../src/leads/lead-writer.service";
import { fakeDb } from "./support/sms-db";

const PHONE = "+15125550123";
const IN_HOURS = new Date("2026-10-06T15:00:00Z");
const AFTER_HOURS = new Date("2026-10-07T03:30:00Z");

const LEAD = {
	contactId: "contact-1",
	phone: PHONE,
	firstName: "Ana",
	origin: RecordSource.LEAD_IMPORT,
};

const CONSENT = {
	id: "consent-1",
	contactId: "contact-1",
	e164: PHONE,
	source: "WEB_FORM",
	revokedAt: null,
};

type SmsSetting = Prisma.InputJsonValue | null;

function harness(
	seed: Parameters<typeof fakeDb>[0] = {},
	sms: SmsSetting = null,
) {
	const { state, db } = fakeDb({ consents: [CONSENT], ...seed });
	const tx = {
		...db,
		appSetting: { findUnique: async () => ({ sms }) },
	} as unknown as Prisma.TransactionClient;
	const client = db as unknown as Db;
	const service = new FirstTouchService(
		new ConsentService(client),
		new SuppressionService(client),
	);
	return { state, tx, service };
}

describe("planFirstTouch", () => {
	const ok = {
		alreadyQueued: false,
		suppressed: false,
		consent: true,
		dueAt: IN_HOURS,
	};

	it("queues a consented, unsuppressed lead at the next window", () => {
		expect(planFirstTouch(ok)).toEqual({ queue: true, dueAt: IN_HOURS });
	});

	it("skips for each blocking fact, most final first", () => {
		expect(
			planFirstTouch({ ...ok, alreadyQueued: true, suppressed: true }),
		).toEqual({ queue: false, reason: "already-queued" });
		expect(planFirstTouch({ ...ok, suppressed: true, consent: false })).toEqual(
			{ queue: false, reason: "suppressed" },
		);
		expect(planFirstTouch({ ...ok, consent: false })).toEqual({
			queue: false,
			reason: "no-consent",
		});
		expect(planFirstTouch({ ...ok, dueAt: null })).toEqual({
			queue: false,
			reason: "no-send-window",
		});
	});
});

describe("FirstTouchService.enqueue", () => {
	it("queues a first-touch task due now inside the send window", async () => {
		const { state, tx, service } = harness({ workspaceName: "Acme Insurance" });

		expect(await service.enqueue(tx, LEAD, IN_HOURS)).toEqual({
			queue: true,
			dueAt: IN_HOURS,
		});

		expect(state.tasks).toHaveLength(1);
		const [task] = state.tasks;
		expect(task?.kind).toBe("first-touch");
		expect(task?.contactId).toBe("contact-1");
		expect(parseFirstTouchTaskPayload(task?.payload)).toEqual({
			type: "lead.created",
			to: PHONE,
			message:
				"Hello Ana, this is Acme Insurance. Are you interested in life or health coverage? Reply STOP to opt out.",
			origin: "LEAD_IMPORT",
		});
	});

	it("defers the task to the next send window after quiet hours start", async () => {
		const { state, tx, service } = harness();
		const expected = nextSendWindow(
			AFTER_HOURS,
			sendWindowFor({ e164: PHONE }),
		);

		const plan = await service.enqueue(tx, LEAD, AFTER_HOURS);

		expect(expected?.getTime()).toBeGreaterThan(AFTER_HOURS.getTime());
		expect(plan).toEqual({ queue: true, dueAt: expected ?? AFTER_HOURS });
		expect(state.tasks).toHaveLength(1);
	});

	it("renders the owner's wording with the business name filled in", async () => {
		const { state, tx, service } = harness(
			{ workspaceName: "Acme" },
			{ firstMessageTemplate: "{agency} here for {firstName}. Reply STOP." },
		);

		await service.enqueue(tx, { ...LEAD, firstName: null }, IN_HOURS);

		expect(parseFirstTouchTaskPayload(state.tasks[0]?.payload).message).toBe(
			"Acme here for there. Reply STOP.",
		);
	});

	it("uses the default wording when nothing is stored", async () => {
		const { state, tx, service } = harness({ workspaceName: "Acme" });

		await service.enqueue(tx, { ...LEAD, firstName: "  aNA " }, IN_HOURS);

		expect(parseFirstTouchTaskPayload(state.tasks[0]?.payload).message).toBe(
			"Hello Ana, this is Acme. Are you interested in life or health coverage? Reply STOP to opt out.",
		);
	});

	it("is idempotent per contact", async () => {
		const { state, tx, service } = harness();

		await service.enqueue(tx, LEAD, IN_HOURS);
		expect(await service.enqueue(tx, LEAD, IN_HOURS)).toEqual({
			queue: false,
			reason: "already-queued",
		});
		expect(state.tasks).toHaveLength(1);
	});

	it("does not queue a suppressed number", async () => {
		const { state, tx, service } = harness({
			suppressions: [{ e164: PHONE, reason: "STOP_KEYWORD" }],
		});

		expect(await service.enqueue(tx, LEAD, IN_HOURS)).toEqual({
			queue: false,
			reason: "suppressed",
		});
		expect(state.tasks).toHaveLength(0);
	});

	it("does not queue a contact without active consent", async () => {
		const { state, tx, service } = harness({
			consents: [{ ...CONSENT, revokedAt: IN_HOURS }],
		});

		expect(await service.enqueue(tx, LEAD, IN_HOURS)).toEqual({
			queue: false,
			reason: "no-consent",
		});
		expect(state.tasks).toHaveLength(0);
	});

	it("fails loudly on an unreadable settings value", async () => {
		const { tx, service } = harness({}, { ambiguousMode: 42 });

		await expect(service.enqueue(tx, LEAD, IN_HOURS)).rejects.toThrow(
			/Unreadable sms settings/,
		);
	});
});

describe("LeadWriterService.write", () => {
	it("queues a first touch for each lead it creates, in the same transaction", async () => {
		const { state, tx, service } = harness({ consents: [] });
		const contactTx = {
			...tx,
			contact: {
				create: async ({
					data,
				}: {
					data: {
						firstName: string;
						consentRecords: { create: { source: string; e164: string } };
					};
				}) => {
					state.consents.push({
						id: "consent-new",
						contactId: "contact-new",
						e164: data.consentRecords.create.e164,
						source: data.consentRecords.create.source,
						revokedAt: null,
					});
					return {
						id: "contact-new",
						firstName: data.firstName,
						lastName: null,
						email: null,
						companyId: null,
						createdAt: IN_HOURS,
					};
				},
			},
		} as unknown as Prisma.TransactionClient;
		const agents = {
			withCrmEvents: <Result>(
				work: (
					client: Prisma.TransactionClient,
					emit: () => Promise<void>,
				) => Promise<Result>,
			) => work(contactTx, async () => undefined),
		};
		const writer = new LeadWriterService(
			{} as Db,
			agents as unknown as AgentTriggerService,
			service,
		);

		const [result] = await writer.write(
			{
				results: [
					{
						rowNumber: 2,
						phone: PHONE,
						status: "ready",
						reasons: [],
						contactId: null,
					},
				],
				ready: [
					{
						rowNumber: 2,
						lead: {
							firstName: "Ana",
							lastName: null,
							email: null,
							phone: PHONE,
							consent: {
								source: "WEB_FORM",
								capturedAt: IN_HOURS,
								optInText: "I agree to texts",
								optInUrl: null,
								ip: null,
							},
						},
					},
				],
			},
			RecordSource.LEAD_IMPORT,
		);

		expect(result?.status).toBe("created");
		expect(state.tasks.map((task) => [task.kind, task.contactId])).toEqual([
			["first-touch", "contact-new"],
		]);
	});
});
