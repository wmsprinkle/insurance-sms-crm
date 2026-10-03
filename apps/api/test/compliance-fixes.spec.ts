import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Db } from "@crm/db";
import { ForbiddenException } from "@nestjs/common";
import type { AgentQueueService } from "../src/agent/agent-queue.service";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import type { CompanyDirectoryService } from "../src/companies/company-directory.service";
import { ComplianceAdminService } from "../src/compliance/compliance-admin.service";
import { COMPLIANCE } from "../src/compliance/compliance-config";
import { ConsentService } from "../src/compliance/consent.service";
import {
	retainedConsentSnapshot,
	retainUntil,
} from "../src/compliance/consent-retention";
import {
	isWithinSendWindow,
	sendWindowFor,
} from "../src/compliance/quiet-hours";
import { frequencyRetryAt, SendGateService } from "../src/compliance/send-gate";
import { SuppressionService } from "../src/compliance/suppression.service";
import { ContactsService } from "../src/contacts/contacts.service";
import type { ActivityStampService } from "../src/crm/activity-stamp.service";
import type { FieldsService } from "../src/fields/fields.service";
import { KeywordService } from "../src/sms/keyword.service";
import { optOutIntentOf } from "../src/sms/keywords";
import { RateLimiter } from "../src/sms/rate-limiter";
import { readRawBody } from "../src/sms/raw-body";
import { SmsService } from "../src/sms/sms.service";
import { sendResponse } from "../src/sms/sms-internal";
import { SmsSender } from "../src/sms/sms-sender.service";
import { TelnyxClient } from "../src/sms/telnyx.client";
import type { TelnyxInbound } from "../src/sms/telnyx-event";
import { fakeDb } from "./support/sms-db";

const PHONE = "+15125550123";
const CONTACT = { id: "contact-1", phone: PHONE, archivedAt: null };
const OPEN = new Date("2026-10-05T17:00:00Z");
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const consent = (e164 = PHONE) => ({
	id: "c1",
	contactId: CONTACT.id,
	e164,
	source: "WEB_FORM",
	revokedAt: null,
});

function inbound(overrides: Partial<TelnyxInbound> = {}): TelnyxInbound {
	return {
		kind: "received",
		eventId: "evt-1",
		telnyxId: "in-1",
		from: PHONE,
		to: "+18005550100",
		text: "Hello",
		...overrides,
	};
}

function harness(
	seed: Parameters<typeof fakeDb>[0] = {},
	onSleep: () => void = () => undefined,
) {
	const { state, db } = fakeDb({
		contacts: [CONTACT],
		consents: [consent()],
		...seed,
	});
	const client = db as unknown as Db;
	const consents = new ConsentService(client);
	const suppression = new SuppressionService(client);
	const gate = new SendGateService(client, consents, suppression);
	let now = 0;
	const telnyx = new TelnyxClient(
		{
			apiKey: null,
			publicKey: null,
			messagingProfileId: null,
			fromNumber: "+18005550100",
			messagesPerSecond: null,
			dryRun: true,
		},
		new RateLimiter(1, 1, {
			now: () => now,
			sleep: async (ms) => {
				onSleep();
				now += ms;
			},
		}),
	);
	const sender = new SmsSender(client, gate, telnyx);
	let drained = 0;
	const sms = new SmsService(
		client,
		{ drainQueues: () => (drained += 1) } as unknown as AgentTriggerService,
		new KeywordService(client, consents, suppression, sender),
	);
	return { state, gate, sender, sms, drained: () => drained };
}

describe("H1: free-text opt-out is handled in the API without the model", () => {
	it("detects common opt-out and wrong-number phrasing", () => {
		for (const text of [
			"please don't text me anymore",
			"Please don’t text me anymore",
			"Stop texting me!!",
			"remove me from your list",
			"leave me alone",
			"unsubscribe me please",
			"STOP please",
			"Do not contact me again.",
		]) {
			expect(optOutIntentOf(text)).toBe("opt_out");
		}
		expect(optOutIntentOf("sorry, wrong number")).toBe("wrong_number");
		expect(optOutIntentOf("You have the wrong person I think")).toBe(
			"wrong_number",
		);
	});

	it("leaves ordinary replies to the agent", () => {
		for (const text of [
			"Yes I'm interested",
			"What does term life cost?",
			"Can you text me tomorrow?",
			"stopped by your office last week",
			"no problem, tell me more",
		]) {
			expect(optOutIntentOf(text)).toBeNull();
		}
	});

	it("suppresses, revokes consent, stops tasks, discards drafts and confirms once", async () => {
		const { sms, state, drained } = harness({
			workspaceName: "Acme Insurance",
			tasks: [
				{
					id: "t1",
					contactId: CONTACT.id,
					kind: "sms-follow-up",
					reason: "Follow up",
					payload: null,
					startedAt: null,
					finishedAt: null,
					outcome: null,
				},
			],
			drafts: [{ id: "d1", contactId: CONTACT.id, status: "PENDING" }],
		});

		expect(
			await sms.receive(inbound({ text: "please don't text me anymore" })),
		).toBe("phrase-opt_out");

		expect(state.suppressions).toMatchObject([
			{ e164: PHONE, reason: "OPT_OUT_REQUEST" },
		]);
		expect(state.consents[0]?.revokedAt).toBeInstanceOf(Date);
		expect(state.tasks[0]).toMatchObject({ outcome: "opted-out" });
		expect(state.tasks.some((task) => task.kind === "sms-reply")).toBe(false);
		expect(state.drafts[0]?.status).toBe("DISCARDED");
		expect(drained()).toBe(0);
		const outbound = state.sms.filter((row) => row.direction === "OUTBOUND");
		expect(outbound).toHaveLength(1);
		expect(outbound[0]?.body).toStartWith(
			"Acme Insurance: You are unsubscribed",
		);
	});

	it("sends no second confirmation for a second opt-out text", async () => {
		const { sms, state } = harness();

		await sms.receive(inbound({ text: "stop texting me" }));
		await sms.receive(inbound({ telnyxId: "in-2", text: "I said remove me" }));

		expect(
			state.sms.filter((row) => row.direction === "OUTBOUND"),
		).toHaveLength(1);
	});

	it("records a wrong number as WRONG_NUMBER without a START hint", async () => {
		const { sms, state } = harness();

		expect(await sms.receive(inbound({ text: "wrong number" }))).toBe(
			"phrase-wrong_number",
		);

		expect(state.suppressions).toMatchObject([
			{ e164: PHONE, reason: "WRONG_NUMBER" },
		]);
		const outbound = state.sms.find((row) => row.direction === "OUTBOUND");
		expect(outbound?.body).not.toContain("START");
	});

	it("suppresses an unknown sender who opts out in free text", async () => {
		const { sms, state } = harness({ contacts: [] });

		expect(
			await sms.receive(
				inbound({ from: "+13055550199", text: "do not text this number" }),
			),
		).toBe("phrase-opt_out");
		expect(state.suppressions).toMatchObject([
			{ e164: "+13055550199", reason: "OPT_OUT_REQUEST" },
		]);
	});
});

describe("H2: no agent turn and no repeat confirmation after an opt-out", () => {
	it("stores an inbound text from a suppressed number without queueing a reply", async () => {
		const { sms, state, drained } = harness({
			suppressions: [{ e164: PHONE, reason: "OPT_OUT_REQUEST" }],
		});

		expect(await sms.receive(inbound({ text: "ok why?" }))).toBe(
			"stored-no-reply",
		);
		expect(state.sms).toHaveLength(1);
		expect(state.tasks).toHaveLength(0);
		expect(drained()).toBe(0);
	});

	it("stores an inbound text without queueing a reply when consent is gone", async () => {
		const { sms, state } = harness({ consents: [] });

		expect(await sms.receive(inbound({ text: "who is this?" }))).toBe(
			"stored-no-reply",
		);
		expect(state.tasks).toHaveLength(0);
	});

	it("allows an opt-out confirmation only right after the suppression, once", async () => {
		const suppressedAt = new Date(OPEN.getTime() - MINUTE_MS);
		const { gate } = harness({
			suppressions: [
				{ e164: PHONE, reason: "OPT_OUT_REQUEST", createdAt: suppressedAt },
			],
		});
		const check = () =>
			gate.check({
				to: PHONE,
				contactId: CONTACT.id,
				purpose: "opt-out-confirmation",
				now: OPEN,
			});

		expect(await check()).toEqual({
			allowed: true,
			reason: "opt-out-confirmation",
		});
		expect(await check()).toMatchObject({
			allowed: false,
			reason: "no-opt-out-to-confirm",
		});
	});

	it("refuses an opt-out confirmation for an old or missing suppression", async () => {
		const old = harness({
			suppressions: [
				{
					e164: PHONE,
					reason: "STOP_KEYWORD",
					createdAt: new Date(OPEN.getTime() - HOUR_MS),
				},
			],
		});
		const none = harness();
		const request = {
			to: PHONE,
			contactId: CONTACT.id,
			purpose: "opt-out-confirmation" as const,
			now: OPEN,
		};

		expect(await old.gate.check(request)).toMatchObject({ allowed: false });
		expect(await none.gate.check(request)).toMatchObject({ allowed: false });
	});

	it("answers a repeat confirmation as suppressed so the agent drafts nothing", () => {
		expect(
			sendResponse({
				status: "blocked",
				decision: {
					allowed: false,
					reason: "no-opt-out-to-confirm",
					retryAt: null,
				},
			}),
		).toEqual({ status: "blocked", reason: "suppressed", retryAt: null });
	});
});

describe("H3: consent belongs to the phone number it was captured for", () => {
	it("blocks a send to a new number that never consented", async () => {
		const { gate } = harness({
			contacts: [{ ...CONTACT, phone: "+15125550999" }],
			consents: [consent(PHONE)],
		});

		expect(
			await gate.check({
				to: "+15125550999",
				contactId: CONTACT.id,
				purpose: "conversation",
				now: OPEN,
			}),
		).toMatchObject({ allowed: false, reason: "no-consent" });
	});

	it("blocks consent rows that have no phone (not back-filled)", async () => {
		const { gate } = harness({
			consents: [{ ...consent(), e164: null }],
		});

		expect(
			await gate.check({
				to: PHONE,
				contactId: CONTACT.id,
				purpose: "conversation",
				now: OPEN,
			}),
		).toMatchObject({ allowed: false, reason: "no-consent" });
	});

	it("records the phone on a START consent", async () => {
		const { sms, state } = harness({
			consents: [],
			suppressions: [{ e164: PHONE, reason: "STOP_KEYWORD" }],
		});

		await sms.receive(inbound({ text: "START" }));

		expect(state.consents).toMatchObject([
			{ contactId: CONTACT.id, e164: PHONE, source: "SMS_KEYWORD" },
		]);
	});
});

describe("H4: purge keeps consent and send-decision proof", () => {
	it("snapshots the contact and keeps it for the retention period", () => {
		const purgedAt = new Date("2026-10-03T12:00:00Z");
		const snapshot = retainedConsentSnapshot(
			"contact-1",
			{ firstName: "Jane", lastName: "Doe", phone: PHONE },
			purgedAt,
		);

		expect(snapshot).toMatchObject({
			contactId: "contact-1",
			phone: PHONE,
			purgedAt: purgedAt.toISOString(),
			retainUntil: "2031-10-03T12:00:00.000Z",
		});
		expect(retainUntil(purgedAt).getUTCFullYear()).toBe(
			2026 + COMPLIANCE.retention.years,
		);
	});

	it("deletes agent events except gate audit and send receipts, and detaches consent", async () => {
		type PrismaArgs = { where?: object; data?: object; select?: object };
		type StubResult = { count: number } | Record<string, string | null>;
		const calls: { op: string; args: PrismaArgs }[] = [];
		const record =
			(op: string, result: StubResult = { count: 1 }) =>
			async (args: PrismaArgs) => {
				calls.push({ op, args });
				return result;
			};
		const tx = {
			$queryRaw: async () => [{ archivedAt: new Date("2020-01-01") }],
			agentTask: { deleteMany: record("agentTask.deleteMany") },
			agentEvent: { deleteMany: record("agentEvent.deleteMany") },
			contact: {
				findUniqueOrThrow: record("contact.findUniqueOrThrow", {
					firstName: "Jane",
					lastName: null,
					phone: PHONE,
				}),
				delete: record("contact.delete", {
					firstName: "Jane",
					lastName: null,
					email: null,
				}),
			},
			consentRecord: { updateMany: record("consentRecord.updateMany") },
			suppressedContact: { upsert: record("suppressedContact.upsert") },
		};
		const db = {
			$transaction: async <T>(work: (client: typeof tx) => Promise<T>) =>
				work(tx),
		};
		const stamp = {
			targetsOf: async () => ({}),
			recomputeAfterDelete: async () => undefined,
		};
		const contacts = new ContactsService(
			db as unknown as Db,
			{} as CompanyDirectoryService,
			{} as AgentTriggerService,
			{} as AgentQueueService,
			stamp as unknown as ActivityStampService,
			{} as FieldsService,
		);

		await contacts.purge("contact-1");

		expect(
			calls.find((call) => call.op === "agentEvent.deleteMany")?.args,
		).toEqual({
			where: {
				contactId: "contact-1",
				sessionId: {
					notIn: ["compliance:send-gate", "sms:send", "sms:keyword"],
				},
			},
		});
		const detach = calls.find((call) => call.op === "consentRecord.updateMany");
		expect(detach?.args).toMatchObject({
			where: { contactId: "contact-1" },
			data: { contactSnapshot: { phone: PHONE } },
		});
		const order = calls.map((call) => call.op);
		expect(order.indexOf("consentRecord.updateMany")).toBeLessThan(
			order.indexOf("contact.delete"),
		);
	});
});

describe("M1: the gate uses the strictest of declared state and area code", () => {
	it("keeps the area-code state's stricter rule when another state is declared", () => {
		const window = sendWindowFor({ e164: "+13055550123", state: "NY" });
		const evening = new Date("2026-10-06T00:30:00Z");

		expect(window.state).toBe("NY");
		expect(window.timezones).toContain("America/Chicago");
		expect(isWithinSendWindow(evening, window)).toBe(false);
		expect(
			isWithinSendWindow(evening, sendWindowFor({ e164: "+12125550123" })),
		).toBe(true);
	});

	it("adds the declared state's zones to the area-code zones", () => {
		const window = sendWindowFor({ e164: "+14155550123", state: "FL" });

		expect(window.timezones).toEqual([
			"America/New_York",
			"America/Chicago",
			"America/Los_Angeles",
		]);
	});

	it("reads the sms_state field when the caller passes no state", async () => {
		const { gate, state } = harness({
			contacts: [{ ...CONTACT, phone: "+12125550123" }],
			consents: [consent("+12125550123")],
			stateFields: [{ contactId: CONTACT.id, text: "FL" }],
		});
		const nineFifteenEastern = new Date("2026-10-06T00:30:00Z");

		const decision = await gate.check({
			to: "+12125550123",
			contactId: CONTACT.id,
			purpose: "conversation",
			now: nineFifteenEastern,
		});

		expect(decision).toMatchObject({ allowed: false, reason: "quiet-hours" });
		expect(state.events.at(-1)?.data).toMatchObject({ state: "FL" });
	});
});

describe("M2: per-recipient frequency cap", () => {
	const now = new Date("2026-10-05T17:00:00Z");
	const ago = (ms: number) => new Date(now.getTime() - ms);

	it("blocks the fourth unanswered text in 24 hours until the oldest ages out", () => {
		const sent = [ago(3 * HOUR_MS), ago(2 * HOUR_MS), ago(HOUR_MS)];

		expect(frequencyRetryAt(sent.slice(1), null, now)).toBeNull();
		expect(frequencyRetryAt(sent, null, now)).toEqual(
			new Date((sent[0]?.getTime() ?? 0) + COMPLIANCE.frequency.day.windowMs),
		);
	});

	it("resets the count when the lead replies", () => {
		const sent = [ago(3 * HOUR_MS), ago(2 * HOUR_MS), ago(HOUR_MS)];

		expect(frequencyRetryAt(sent, ago(90 * MINUTE_MS), now)).toBeNull();
	});

	it("caps the week as well as the day", () => {
		const day = 24 * HOUR_MS;
		const sent = [1, 2, 3, 4, 5, 6, 6.5].map((days) => ago(days * day));

		expect(frequencyRetryAt(sent, null, now)).not.toBeNull();
	});

	it("blocks a conversation send at the cap and answers failed on the bridge", async () => {
		const { gate } = harness({
			sms: [1, 2, 3].map((hours) => ({
				id: `out-${hours}`,
				contactId: CONTACT.id,
				direction: "OUTBOUND",
				body: "hi",
				telnyxId: null,
				status: "SENT",
				errorCode: null,
				createdAt: new Date(OPEN.getTime() - hours * HOUR_MS),
			})),
		});

		const decision = await gate.check({
			to: PHONE,
			contactId: CONTACT.id,
			purpose: "conversation",
			now: OPEN,
		});

		expect(decision).toMatchObject({ allowed: false, reason: "frequency-cap" });
		expect(sendResponse({ status: "blocked", decision })).toEqual({
			status: "blocked",
			reason: "frequency-cap",
			retryAt: decision.allowed
				? null
				: (decision.retryAt?.toISOString() ?? null),
		});
	});
});

describe("M3: STOP discards pending drafts", () => {
	it("moves every pending draft of the contact to DISCARDED", async () => {
		const { sms, state } = harness({
			drafts: [
				{ id: "d1", contactId: CONTACT.id, status: "PENDING" },
				{ id: "d2", contactId: "contact-2", status: "PENDING" },
			],
		});

		await sms.receive(inbound({ text: "STOP" }));

		expect(state.drafts.map((row) => row.status)).toEqual([
			"DISCARDED",
			"PENDING",
		]);
	});
});

describe("M4: the gate runs after the rate-limit wait", () => {
	it("blocks a send when STOP lands while it waits for a slot", async () => {
		let stopArrives = () => undefined;
		const { sender, state } = harness({}, () => stopArrives());
		stopArrives = () => {
			state.suppressions.push({ e164: PHONE, reason: "STOP_KEYWORD" });
		};

		const first = await sender.send({
			to: PHONE,
			contactId: CONTACT.id,
			text: "First",
			purpose: "keyword-reply",
		});
		const second = await sender.send({
			to: PHONE,
			contactId: CONTACT.id,
			text: "Second",
			purpose: "conversation",
		});

		expect(first.status).toBe("sent");
		expect(second).toMatchObject({
			status: "blocked",
			decision: { reason: "suppressed" },
		});
		expect(state.sms.map((row) => row.body)).toEqual(["First"]);
	});
});

describe("M7: role checks on compliance actions", () => {
	function admin(role: string | null) {
		const events: unknown[] = [];
		const db = {
			member: {
				findUnique: async () => (role === null ? null : { role }),
			},
			agentEvent: {
				create: async ({ data }: { data: unknown }) => {
					events.push(data);
					return data;
				},
			},
		};
		return {
			events,
			service: new ComplianceAdminService(db as unknown as Db),
		};
	}

	it("refuses a member who changes compliance settings or imports leads", async () => {
		const { service } = admin("member");

		await expect(service.require("u1", "complianceSettings")).rejects.toThrow(
			ForbiddenException,
		);
		await expect(service.require("u1", "leadImport")).rejects.toThrow(
			ForbiddenException,
		);
		await expect(service.require("u1", "smsSend")).resolves.toBeUndefined();
	});

	it("allows an owner or admin", async () => {
		for (const role of ["owner", "admin"]) {
			const { service } = admin(role);
			await expect(
				service.require("u1", "complianceSettings"),
			).resolves.toBeUndefined();
			await expect(
				service.require("u1", "leadImport"),
			).resolves.toBeUndefined();
		}
	});

	it("refuses a user outside the workspace even for sends", async () => {
		const { service } = admin(null);

		await expect(service.require("u1", "smsSend")).rejects.toThrow(
			ForbiddenException,
		);
	});

	it("writes an audit event", async () => {
		const { service, events } = admin("owner");

		await service.record("u1", "smsSettingsChanged", { autoSend: true });

		expect(events).toMatchObject([
			{
				sessionId: "compliance:admin",
				type: "settings.sms.changed",
				data: { userId: "u1", autoSend: true },
			},
		]);
	});
});

describe("L1: a dropped request body settles", () => {
	it("resolves null when the client closes before the end", async () => {
		const request = new EventEmitter() as unknown as IncomingMessage;
		const body = readRawBody(request, 1024);

		request.emit("data", Buffer.from("partial"));
		request.emit("close");

		expect(await body).toBeNull();
	});

	it("still returns the body when close follows end", async () => {
		const request = new EventEmitter() as unknown as IncomingMessage;
		const body = readRawBody(request, 1024);

		request.emit("data", Buffer.from("whole"));
		request.emit("end");
		request.emit("close");

		expect((await body)?.toString()).toBe("whole");
	});
});

describe("L4: only US (+1) numbers get conversation texts", () => {
	it("blocks a non +1 number before any other check", async () => {
		const { gate } = harness({
			contacts: [{ ...CONTACT, phone: "+442079460958" }],
			consents: [consent("+442079460958")],
		});

		const decision = await gate.check({
			to: "+442079460958",
			contactId: CONTACT.id,
			purpose: "conversation",
			now: OPEN,
		});

		expect(decision).toMatchObject({
			allowed: false,
			reason: "unsupported-number",
		});
		expect(sendResponse({ status: "blocked", decision })).toEqual({
			status: "blocked",
			reason: "unsupported-number",
			retryAt: null,
		});
	});
});
