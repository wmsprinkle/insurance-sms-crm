import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	mock,
	setSystemTime,
	spyOn,
} from "bun:test";
import { db } from "@crm/db";
import { SETTINGS_ID } from "@crm/db/settings";
import { SMS_REPLY_TASK_KIND } from "@crm/validation/sms-reply-task";
import type { AppAuth } from "../../agent/agent/lib/app-auth";
import * as focusModule from "../../agent/agent/lib/focus";
import type { SmsTurnStart } from "../../agent/agent/lib/sms-pipeline";
import {
	finishSmsTurns,
	runLiveSmsTask,
} from "../../agent/agent/lib/sms-runtime";
import { claimDue } from "../../agent/agent/lib/tasks";
import bookMeetingTool from "../../agent/agent/tools/book_meeting";
import classifyReplyTool from "../../agent/agent/tools/classify_reply";
import proposeSlotsTool from "../../agent/agent/tools/propose_slots";
import recordQualificationTool from "../../agent/agent/tools/record_qualification";
import sendSmsTool from "../../agent/agent/tools/send_sms";
import { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { ConsentService } from "../src/compliance/consent.service";
import { nextSendWindow, sendWindowFor } from "../src/compliance/quiet-hours";
import { SendGateService } from "../src/compliance/send-gate";
import { SuppressionService } from "../src/compliance/suppression.service";
import { CalendarInternalService } from "../src/google/calendar-internal.service";
import {
	type CalendarTokens,
	CalendarWriteClient,
} from "../src/google/calendar-write.client";
import { FirstTouchService } from "../src/leads/first-touch.service";
import { LeadImportService } from "../src/leads/lead-import.service";
import { LeadWriterService } from "../src/leads/lead-writer.service";
import { KeywordService } from "../src/sms/keyword.service";
import { RateLimiter } from "../src/sms/rate-limiter";
import { SmsService } from "../src/sms/sms.service";
import { SmsInternalService } from "../src/sms/sms-internal.service";
import { SmsSender } from "../src/sms/sms-sender.service";
import { type Fetcher, TelnyxClient } from "../src/sms/telnyx.client";
import { telnyxPublicKey } from "../src/sms/telnyx-signature";
import { TelnyxWebhookController } from "../src/sms/telnyx-webhook.controller";
import {
	nowSeconds,
	requestWith,
	signTelnyx,
	telnyxBody,
	testKeys,
} from "./support/sms-fakes";

mock.module("../../agent/agent/lib/focus", () => ({
	...focusModule,
	focusOn: () => {},
}));

const API_URL = "http://api.qa.test";
const SECRET = "qa-bridge-secret";
const AGENCY_NUMBER = "+18005550100";
const LEAD_PHONE = "+15125550101";
const NO_CONSENT_PHONE = "+15125550102";
const UNCONSENTED_CONTACT_PHONE = "+15125550103";
const OWNER_ID = "qa-core-loop-owner";
const LEAD_EMAIL = "ana.lead@example.com";

const IMPORTED_AT = new Date("2026-10-06T03:00:00Z");

type SentText = { to: string; text: string };
type GoogleCall = { method: string; path: string; body: string };

const sent: SentText[] = [];
let calls = 0;
const google: GoogleCall[] = [];
const keys = testKeys();
const saved = {
	API_URL: process.env.API_URL,
	AGENT_BRIDGE_SECRET: process.env.AGENT_BRIDGE_SECRET,
	DRY_RUN: process.env.DRY_RUN,
};

function telnyxFetch(_url: string | URL | Request, init?: RequestInit) {
	const body = JSON.parse(String(init?.body ?? "{}"));
	sent.push({ to: body.to, text: body.text });
	return Promise.resolve(
		Response.json({ data: { id: `qa-msg-${sent.length}` } }),
	);
}

function googleFetch(url: string | URL | Request, init?: RequestInit) {
	const target = new URL(String(url));
	const body = String(init?.body ?? "");
	google.push({ method: init?.method ?? "GET", path: target.pathname, body });
	if (target.pathname.endsWith("/freeBusy")) {
		return Promise.resolve(
			Response.json({ calendars: { primary: { busy: [] } } }),
		);
	}
	const event = JSON.parse(body);
	return Promise.resolve(
		Response.json({
			id: event.id,
			status: "confirmed",
			htmlLink: `https://calendar.google.com/event?eid=${event.id}`,
			iCalUID: `${event.id}@google.com`,
			hangoutLink: "https://meet.google.com/qa-core-loop",
		}),
	);
}

const tokens: CalendarTokens = {
	grantedScopes: () =>
		Promise.resolve(
			new Set([
				"https://www.googleapis.com/auth/calendar.readonly",
				"https://www.googleapis.com/auth/calendar.events",
				"https://www.googleapis.com/auth/calendar.freebusy",
			]),
		),
	accessTokenFor: () =>
		Promise.resolve({ outcome: "ok" as const, accessToken: "qa-token" }),
};

const consent = new ConsentService(db);
const suppression = new SuppressionService(db);
const gate = new SendGateService(db, consent, suppression);
const telnyx = new TelnyxClient(
	{
		apiKey: "qa-key",
		publicKey: keys.publicKeyBase64,
		messagingProfileId: "qa-profile",
		fromNumber: AGENCY_NUMBER,
		messagesPerSecond: 1_000,
		dryRun: false,
	},
	new RateLimiter(1_000, 1_000),
	telnyxFetch as unknown as Fetcher,
);
const sender = new SmsSender(db, gate, telnyx);
const smsInternal = new SmsInternalService(db, sender, sender);
const trigger = new AgentTriggerService(db);
const smsService = new SmsService(
	db,
	trigger,
	new KeywordService(db, consent, suppression, sender),
);
const webhook = new TelnyxWebhookController(
	smsService,
	telnyxPublicKey(keys.publicKeyBase64),
);
const calendarInternal = new CalendarInternalService(
	db,
	new CalendarWriteClient(tokens, googleFetch),
	() => new Date(),
);
const importer = new LeadImportService(
	new LeadWriterService(
		db,
		trigger,
		new FirstTouchService(consent, suppression),
	),
);

async function apiFetch(url: string | URL | Request, init?: RequestInit) {
	const target = new URL(String(url));
	if (target.origin !== API_URL) return new Response(null, { status: 204 });
	expect(init?.headers).toMatchObject({ authorization: `Bearer ${SECRET}` });
	const body = JSON.parse(String(init?.body ?? "{}"));
	if (target.pathname === "/internal/sms/send") {
		return Response.json(await smsInternal.send(body));
	}
	if (target.pathname === "/internal/calendar/book") {
		return Response.json(await calendarInternal.handle(body));
	}
	return new Response(null, { status: 404 });
}

async function inbound(text: string, telnyxId: string, from = LEAD_PHONE) {
	const body = telnyxBody({
		eventType: "message.received",
		telnyxId,
		from,
		to: AGENCY_NUMBER,
		text,
	});
	const timestamp = nowSeconds();
	return webhook.receive(
		requestWith(body),
		signTelnyx(keys.privateKey, timestamp, body),
		timestamp,
	);
}

function toolContext(turn: SmsTurnStart) {
	const base: AppAuth = {
		attributes: { taskKind: SMS_REPLY_TASK_KIND, contactId: turn.contactId },
		authenticator: "crm",
		principalId: "qa-agent",
		principalType: "service",
	};
	const auth = turn.auth(base);
	calls += 1;
	return {
		callId: `qa-call-${calls}`,
		session: {
			auth: { current: { attributes: auth.attributes }, initiator: null },
		},
	} as never;
}

async function runDueSmsTasks(model: (turn: SmsTurnStart) => Promise<void>) {
	const tasks = await claimDue(10, {
		only: ["first-touch", SMS_REPLY_TASK_KIND],
	});
	for (const task of tasks) {
		await runLiveSmsTask(task, async (turn) => {
			await model(turn);
			return { id: `qa-session-${task.id}` };
		});
		if (task.contactId) await finishSmsTurns(task.contactId, "qa turn done");
	}
	return tasks;
}

async function contactIdFor(phone: string) {
	const row = await db.contact.findFirst({
		where: { phone, archivedAt: null },
		select: { id: true },
	});
	return row?.id ?? null;
}

const noModel = async () => {
	throw new Error("The model was not expected to run.");
};

let fetchSpy: ReturnType<typeof spyOn>;
let leadId = "";
let offered: { start: string; label: string }[] = [];

beforeAll(async () => {
	process.env.API_URL = API_URL;
	process.env.AGENT_BRIDGE_SECRET = SECRET;
	process.env.DRY_RUN = "false";
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation(apiFetch as never);
	setSystemTime(IMPORTED_AT);

	await db.user.upsert({
		where: { id: OWNER_ID },
		create: { id: OWNER_ID, name: "QA Owner", email: "owner@qa.test" },
		update: {},
	});
	await db.account.upsert({
		where: { id: `${OWNER_ID}-google` },
		create: {
			id: `${OWNER_ID}-google`,
			accountId: "qa-google",
			providerId: "google",
			userId: OWNER_ID,
		},
		update: {},
	});
	await db.appSetting.upsert({
		where: { id: SETTINGS_ID },
		create: {
			id: SETTINGS_ID,
			sms: { autoSend: true },
			calendar: { ownerUserId: OWNER_ID },
		},
		update: { sms: { autoSend: true }, calendar: { ownerUserId: OWNER_ID } },
	});
});

afterAll(() => {
	fetchSpy.mockRestore();
	setSystemTime();
	process.env.API_URL = saved.API_URL ?? "";
	process.env.AGENT_BRIDGE_SECRET = saved.AGENT_BRIDGE_SECRET ?? "";
	process.env.DRY_RUN = saved.DRY_RUN ?? "";
});

describe("core loop: import, first touch, reply, qualify, book, stop", () => {
	it("imports the consented lead and rejects the row without consent", async () => {
		const csv = [
			"First Name,Last Name,Phone,Consent Source,Consent Date,Opt In Text",
			`Ana,Lead,${LEAD_PHONE},web_form,2026-10-01T15:00:00Z,I agree to receive texts about my quote.`,
			`Bob,Nocon,${NO_CONSENT_PHONE},,,`,
		].join("\n");

		const result = await importer.commit({
			csv,
			mapping: {
				firstName: "First Name",
				lastName: "Last Name",
				phone: "Phone",
				consentSource: "Consent Source",
				consentCapturedAt: "Consent Date",
				optInText: "Opt In Text",
			},
		});

		expect(result.totals.created).toBe(1);
		expect(result.totals.rejected).toBe(1);
		leadId = (await contactIdFor(LEAD_PHONE)) ?? "";
		expect(leadId).not.toBe("");
		expect(await contactIdFor(NO_CONSENT_PHONE)).toBeNull();
	});

	it("queues one first-touch task at the next send window", async () => {
		const task = await db.agentTask.findFirstOrThrow({
			where: { contactId: leadId, kind: "first-touch" },
		});
		const window = nextSendWindow(
			IMPORTED_AT,
			sendWindowFor({ e164: LEAD_PHONE, state: null }),
		);

		expect(window).not.toBeNull();
		expect(task.dueAt.getTime()).toBe(window?.getTime() ?? 0);
		expect(task.dueAt.getTime()).toBeGreaterThan(IMPORTED_AT.getTime());

		expect(await runDueSmsTasks(noModel)).toHaveLength(0);
		expect(sent).toHaveLength(0);
	});

	it("sends the first touch once the window opens", async () => {
		const task = await db.agentTask.findFirstOrThrow({
			where: { contactId: leadId, kind: "first-touch" },
		});
		setSystemTime(new Date(task.dueAt.getTime() + 60_000));

		expect(await runDueSmsTasks(noModel)).toHaveLength(1);

		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toBe(LEAD_PHONE);
		expect(sent[0]?.text).toMatch(
			/^Hello \w+, Are you interested in life or health coverage\?$/,
		);
		const done = await db.agentTask.findUniqueOrThrow({
			where: { id: task.id },
		});
		expect(done.finishedAt).not.toBeNull();
	});

	it("turns a signed inbound reply into a qualified lead with offered slots", async () => {
		const answer = await inbound(
			"Yes, term life please. I'm in Texas, 42, want 500k and ready now.",
			"qa-in-1",
		);
		expect(answer).toEqual({ event: "received", outcome: "stored" });

		const tasks = await runDueSmsTasks(async (turn) => {
			const ctx = toolContext(turn);
			expect(turn.message).toContain("term life");
			await classifyReplyTool.execute({ label: "interested" }, ctx);
			const verdict = await recordQualificationTool.execute(
				{
					line: "term_life",
					state: "TX",
					ageBand: "40-49",
					coverage: "500k",
					timeline: "now",
				},
				ctx,
			);
			expect(verdict).toMatchObject({ ok: true });
			const slots = await proposeSlotsTool.execute({}, ctx);
			expect(slots).toMatchObject({ status: "slots" });
			offered = "slots" in slots ? slots.slots : [];
			expect(offered.length).toBeGreaterThanOrEqual(2);
			const offer = await sendSmsTool.execute(
				{
					body: `Great. I can do ${offered[0]?.label} or ${offered[1]?.label}. Which works?`,
				},
				ctx,
			);
			expect(offer).toMatchObject({ status: "sent" });
		});

		expect(tasks.map((task) => task.kind)).toEqual([SMS_REPLY_TASK_KIND]);
		expect(sent).toHaveLength(2);
		const deal = await db.dealContact.findFirstOrThrow({
			where: { contactId: leadId },
			select: { deal: { select: { stage: true } } },
		});
		expect(deal.deal.stage).toBe("QUALIFIED_TO_BUY");
	});

	it("books the chosen slot, marks the deal demo booked and confirms by text", async () => {
		await inbound(`The first one works. My email is ${LEAD_EMAIL}`, "qa-in-2");

		await runDueSmsTasks(async (turn) => {
			const booked = await bookMeetingTool.execute(
				{ start: offered[0]?.start ?? "", email: LEAD_EMAIL },
				toolContext(turn),
			);
			expect(booked).toMatchObject({ status: "booked" });
		});

		const insert = google.find((call) => call.path.endsWith("/events"));
		expect(insert?.body).toContain(LEAD_EMAIL);
		const event = await db.calendarEvent.findFirstOrThrow({
			where: { attendees: { some: { email: LEAD_EMAIL } } },
		});
		expect(event.startsAt.toISOString()).toBe(
			new Date(offered[0]?.start ?? "").toISOString(),
		);
		const deal = await db.dealContact.findFirstOrThrow({
			where: { contactId: leadId },
			select: { deal: { select: { stage: true } } },
		});
		expect(deal.deal.stage).toBe("DEMO_BOOKED");
		expect(sent).toHaveLength(3);
		expect(sent[2]?.to).toBe(LEAD_PHONE);
	});

	it("suppresses the number on STOP and blocks every later send", async () => {
		const answer = await inbound("STOP", "qa-in-3");
		expect(answer.event).toBe("received");

		expect(
			await db.phoneSuppression.findUnique({ where: { e164: LEAD_PHONE } }),
		).not.toBeNull();
		const afterStop = sent.length;
		expect(sent[afterStop - 1]?.to).toBe(LEAD_PHONE);

		const attempt = await smsInternal.send({
			contactId: leadId,
			to: LEAD_PHONE,
			text: "Just checking in about your quote.",
			taskId: null,
			purpose: "conversation",
			idempotencyKey: "qa-after-stop",
			dryRun: false,
		});
		expect(attempt).toMatchObject({ status: "blocked", reason: "suppressed" });

		await inbound("Wait, one more question", "qa-in-4");
		await runDueSmsTasks(async (turn) => {
			const reply = await sendSmsTool.execute(
				{ body: "Happy to help with that question." },
				toolContext(turn),
			);
			expect(reply).toMatchObject({ status: "refused" });
		});

		expect(sent.length).toBe(afterStop);
	});

	it("never texts a contact that has no consent record", async () => {
		const contact = await db.contact.create({
			data: { firstName: "Cara", phone: UNCONSENTED_CONTACT_PHONE },
			select: { id: true },
		});
		const before = sent.length;

		const attempt = await smsInternal.send({
			contactId: contact.id,
			to: UNCONSENTED_CONTACT_PHONE,
			text: "Hi Cara, can we help with a quote?",
			taskId: null,
			purpose: "conversation",
			idempotencyKey: "qa-no-consent",
			dryRun: false,
		});

		expect(attempt).toMatchObject({ status: "blocked", reason: "no-consent" });
		expect(sent.length).toBe(before);
		expect(sent.some((text) => text.to === NO_CONSENT_PHONE)).toBe(false);
		expect(sent.some((text) => text.to === UNCONSENTED_CONTACT_PHONE)).toBe(
			false,
		);
	});
});
