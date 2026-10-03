import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import type { SmsSendRequest } from "@crm/validation/sms-send";
import type { ConfigService } from "@nestjs/config";
import { ConsentService } from "../src/compliance/consent.service";
import { SendGateService } from "../src/compliance/send-gate";
import { SuppressionService } from "../src/compliance/suppression.service";
import type { EnvironmentVariables } from "../src/config/env.validation";
import { RateLimiter } from "../src/sms/rate-limiter";
import {
	bridgeAuthorised,
	gatePurpose,
	SMS_INTERNAL,
	sendResponse,
} from "../src/sms/sms-internal";
import { SmsInternalController } from "../src/sms/sms-internal.controller";
import { SmsInternalService } from "../src/sms/sms-internal.service";
import {
	type OutboundSms,
	type SendOutcome,
	SmsSender,
} from "../src/sms/sms-sender.service";
import { type Fetcher, TelnyxClient } from "../src/sms/telnyx.client";
import { fakeDb } from "./support/sms-db";
import { requestWith } from "./support/sms-fakes";

const SECRET = "bridge-secret";
const TO = "+12125550123";

const contact = { id: "contact-1", phone: TO, archivedAt: null };

const request: SmsSendRequest = {
	contactId: "contact-1",
	to: TO,
	text: "Hi, it's the agency.",
	purpose: "conversation",
	idempotencyKey: "task-1:reply-1",
	taskId: "task-1",
	dryRun: false,
};

const sentOutcome: SendOutcome = {
	status: "sent",
	telnyxId: "msg-1",
	dryRun: false,
	decision: { allowed: true, reason: "consented" },
};

function scriptedSender(outcomes: SendOutcome[]) {
	const calls: OutboundSms[] = [];
	const sender = {
		send: async (sms: OutboundSms) => {
			calls.push(sms);
			const next = outcomes.shift();
			if (!next) throw new Error("No scripted outcome left");
			return next;
		},
	} as unknown as SmsSender;
	return { calls, sender };
}

function service(
	seed: Parameters<typeof fakeDb>[0],
	live: SmsSender,
	dry: SmsSender = live,
) {
	const { state, db } = fakeDb({ contacts: [contact], ...seed });
	return {
		state,
		sms: new SmsInternalService(db as unknown as Db, live, dry),
	};
}

describe("bridgeAuthorised", () => {
	it("accepts only the exact bearer secret", () => {
		expect(bridgeAuthorised(`Bearer ${SECRET}`, SECRET)).toBe(true);
		expect(bridgeAuthorised(undefined, SECRET)).toBe(false);
		expect(bridgeAuthorised(SECRET, SECRET)).toBe(false);
		expect(bridgeAuthorised(`Bearer ${SECRET}x`, SECRET)).toBe(false);
		expect(bridgeAuthorised("Bearer bridge-secreT", SECRET)).toBe(false);
		expect(bridgeAuthorised("Basic bridge-secret", SECRET)).toBe(false);
	});
});

describe("gatePurpose", () => {
	it("gives the opt-out confirmation its own gate purpose, not keyword-reply", () => {
		expect(gatePurpose("opt-out-confirmation")).toBe("opt-out-confirmation");
		expect(gatePurpose("conversation")).toBe("conversation");
		expect(gatePurpose("first-touch")).toBe("conversation");
		expect(gatePurpose("handoff")).toBe("conversation");
	});
});

describe("sendResponse", () => {
	it("carries the quiet-hours retry time as ISO", () => {
		const retryAt = new Date("2026-10-04T13:00:00.000Z");

		expect(
			sendResponse({
				status: "blocked",
				decision: { allowed: false, reason: "quiet-hours", retryAt },
			}),
		).toEqual({
			status: "blocked",
			reason: "quiet-hours",
			retryAt: retryAt.toISOString(),
		});
	});

	it("drops the gate decision from sent and failed outcomes", () => {
		expect(sendResponse(sentOutcome)).toEqual({
			status: "sent",
			telnyxId: "msg-1",
			dryRun: false,
		});
		expect(
			sendResponse({
				status: "failed",
				decision: { allowed: true, reason: "consented" },
				error: "refused",
			}),
		).toEqual({ status: "failed", error: "refused" });
	});
});

describe("SmsInternalService", () => {
	it("sends through the live sender and stores a sent receipt", async () => {
		const { calls, sender } = scriptedSender([sentOutcome]);
		const { sms, state } = service({}, sender);

		const response = await sms.send(request);

		expect(response).toEqual({
			status: "sent",
			telnyxId: "msg-1",
			dryRun: false,
		});
		expect(calls).toEqual([
			{
				to: TO,
				contactId: "contact-1",
				text: request.text,
				purpose: "conversation",
				receiptId: `${SMS_INTERNAL.idempotency.idPrefix}${request.idempotencyKey}`,
			},
		]);
		expect(state.events).toMatchObject([
			{
				id: `${SMS_INTERNAL.idempotency.idPrefix}${request.idempotencyKey}`,
				sessionId: SMS_INTERNAL.idempotency.sessionId,
				type: SMS_INTERNAL.idempotency.sent,
			},
		]);
	});

	it("replays a sent response for a repeated key and sends once", async () => {
		const { calls, sender } = scriptedSender([sentOutcome]);
		const { sms } = service({}, sender);

		const first = await sms.send(request);
		const second = await sms.send(request);

		expect(second).toEqual(first);
		expect(calls).toHaveLength(1);
	});

	it("releases the key after a block so a later retry sends", async () => {
		const retryAt = new Date("2026-10-04T13:00:00.000Z");
		const { calls, sender } = scriptedSender([
			{
				status: "blocked",
				decision: { allowed: false, reason: "quiet-hours", retryAt },
			},
			sentOutcome,
		]);
		const { sms } = service({}, sender);

		const blocked = await sms.send(request);
		const retried = await sms.send(request);

		expect(blocked).toEqual({
			status: "blocked",
			reason: "quiet-hours",
			retryAt: retryAt.toISOString(),
		});
		expect(retried.status).toBe("sent");
		expect(calls).toHaveLength(2);
	});

	it("answers in progress while another send holds the key", async () => {
		const { calls, sender } = scriptedSender([]);
		const { sms } = service(
			{
				events: [
					{
						id: `${SMS_INTERNAL.idempotency.idPrefix}${request.idempotencyKey}`,
						sessionId: SMS_INTERNAL.idempotency.sessionId,
						contactId: "contact-1",
						type: SMS_INTERNAL.idempotency.claimed,
						data: {},
						emittedAt: new Date(),
					},
				],
			},
			sender,
		);

		const response = await sms.send(request);

		expect(response).toEqual({
			status: "failed",
			error: SMS_INTERNAL.errors.inProgress,
		});
		expect(calls).toHaveLength(0);
	});

	it("uses the dry-run sender when the request asks for a dry run", async () => {
		const live = scriptedSender([]);
		const dry = scriptedSender([{ ...sentOutcome, dryRun: true }]);
		const { sms } = service({}, live.sender, dry.sender);

		const response = await sms.send({ ...request, dryRun: true });

		expect(response).toMatchObject({ status: "sent", dryRun: true });
		expect(live.calls).toHaveLength(0);
		expect(dry.calls).toHaveLength(1);
	});

	it("sends a fixed opt-out confirmation keyed per suppression, not per call", async () => {
		const suppressedAt = new Date("2026-10-05T15:00:00Z");
		const { calls, sender } = scriptedSender([sentOutcome]);
		const { sms, state } = service(
			{
				suppressions: [
					{ e164: TO, reason: "OPT_OUT_REQUEST", createdAt: suppressedAt },
				],
			},
			sender,
		);

		await sms.send({
			...request,
			purpose: "opt-out-confirmation",
			text: "Anything the agent wrote",
			idempotencyKey: "call-1",
		});
		const repeat = await sms.send({
			...request,
			purpose: "opt-out-confirmation",
			text: "Anything else",
			idempotencyKey: "call-2",
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]?.purpose).toBe("opt-out-confirmation");
		expect(calls[0]?.text).toStartWith("Our team: You are unsubscribed");
		expect(repeat).toMatchObject({ status: "sent" });
		expect(state.events[0]?.id).toBe(
			`${SMS_INTERNAL.idempotency.idPrefix}opt-out:${TO}:${suppressedAt.getTime()}`,
		);
	});

	it("refuses a reused key whose stored send had a different text or contact", async () => {
		const { calls, sender } = scriptedSender([sentOutcome, sentOutcome]);
		const { sms } = service({}, sender);

		await sms.send(request);
		const otherText = await sms.send({ ...request, text: "A different text" });
		const same = await sms.send(request);

		expect(otherText).toEqual({
			status: "failed",
			error: SMS_INTERNAL.errors.keyReused,
		});
		expect(same).toMatchObject({ status: "sent" });
		expect(calls).toHaveLength(1);
	});

	it("refuses an opt-out confirmation when the number is not suppressed", async () => {
		const { calls, sender } = scriptedSender([]);
		const { sms } = service({}, sender);

		expect(
			await sms.send({ ...request, purpose: "opt-out-confirmation" }),
		).toEqual({ status: "failed", error: SMS_INTERNAL.errors.noOptOut });
		expect(calls).toHaveLength(0);
	});

	it("uses the wrong-number wording for a wrong-number suppression", async () => {
		const { calls, sender } = scriptedSender([sentOutcome]);
		const { sms } = service(
			{ suppressions: [{ e164: TO, reason: "WRONG_NUMBER" }] },
			sender,
		);

		await sms.send({ ...request, purpose: "opt-out-confirmation" });

		expect(calls[0]?.text).toContain("Sorry for the mix-up");
		expect(calls[0]?.text).not.toContain("START");
	});

	it("reclaims a claim older than the lease when no message was written", async () => {
		const { calls, sender } = scriptedSender([sentOutcome]);
		const { sms } = service(
			{
				events: [
					{
						id: `${SMS_INTERNAL.idempotency.idPrefix}${request.idempotencyKey}`,
						sessionId: SMS_INTERNAL.idempotency.sessionId,
						contactId: "contact-1",
						type: SMS_INTERNAL.idempotency.claimed,
						data: {},
						emittedAt: new Date(Date.now() - SMS_INTERNAL.lease.claimMs - 1),
					},
				],
			},
			sender,
		);

		expect(await sms.send(request)).toMatchObject({ status: "sent" });
		expect(calls).toHaveLength(1);
	});

	it("keeps a stale claim when the message was already written", async () => {
		const claimedAt = new Date(Date.now() - SMS_INTERNAL.lease.claimMs - 1);
		const { calls, sender } = scriptedSender([]);
		const { sms } = service(
			{
				events: [
					{
						id: `${SMS_INTERNAL.idempotency.idPrefix}${request.idempotencyKey}`,
						sessionId: SMS_INTERNAL.idempotency.sessionId,
						contactId: "contact-1",
						type: SMS_INTERNAL.idempotency.claimed,
						data: {},
						emittedAt: claimedAt,
					},
				],
				sms: [
					{
						id: "sms-x",
						contactId: "contact-1",
						direction: "OUTBOUND",
						body: request.text,
						telnyxId: "m-x",
						status: "SENDING",
						errorCode: null,
						createdAt: new Date(claimedAt.getTime() + 1),
					},
				],
			},
			sender,
		);

		expect(await sms.send(request)).toEqual({
			status: "failed",
			error: SMS_INTERNAL.errors.inProgress,
		});
		expect(calls).toHaveLength(0);
	});

	it("refuses a number that is not the contact's phone", async () => {
		const { calls, sender } = scriptedSender([]);
		const { sms, state } = service({}, sender);

		const response = await sms.send({ ...request, to: "+13125550199" });

		expect(response).toEqual({
			status: "failed",
			error: SMS_INTERNAL.errors.wrongNumber,
		});
		expect(calls).toHaveLength(0);
		expect(state.events).toHaveLength(0);
	});

	it("refuses an archived or unknown contact", async () => {
		const { sender } = scriptedSender([]);
		const { sms } = service(
			{ contacts: [{ ...contact, archivedAt: new Date() }] },
			sender,
		);

		expect(await sms.send(request)).toEqual({
			status: "failed",
			error: SMS_INTERNAL.errors.unknownContact,
		});
	});

	it("releases the key when the sender throws", async () => {
		const sender = {
			send: async () => {
				throw new Error("database down");
			},
		} as unknown as SmsSender;
		const { sms, state } = service({}, sender);

		await expect(sms.send(request)).rejects.toThrow("database down");
		expect(state.events[0]?.type).toBe(SMS_INTERNAL.idempotency.released);
	});
});

describe("SmsInternalService with the real gate", () => {
	function realSender(seed: Parameters<typeof fakeDb>[0]) {
		const { state, db } = fakeDb({ contacts: [contact], ...seed });
		const client = db as unknown as Db;
		let fetches = 0;
		const telnyx = new TelnyxClient(
			{
				apiKey: "test-key",
				publicKey: null,
				messagingProfileId: null,
				fromNumber: "+18005550100",
				messagesPerSecond: null,
				dryRun: true,
			},
			new RateLimiter(10, 10, { now: () => 0, sleep: async () => undefined }),
			(async () => {
				fetches += 1;
				return new Response("{}");
			}) as unknown as Fetcher,
		);
		const gate = new SendGateService(
			client,
			new ConsentService(client),
			new SuppressionService(client),
		);
		const sender = new SmsSender(client, gate, telnyx);
		return {
			state,
			fetches: () => fetches,
			sms: new SmsInternalService(client, sender, sender),
		};
	}

	it("blocks a contact without consent and sends nothing", async () => {
		const { sms, state, fetches } = realSender({});

		expect(await sms.send(request)).toEqual({
			status: "blocked",
			reason: "no-consent",
			retryAt: null,
		});
		expect(fetches()).toBe(0);
		expect(state.sms).toHaveLength(0);
	});

	it("blocks a suppressed number even with consent", async () => {
		const { sms } = realSender({
			consents: [
				{
					id: "c1",
					contactId: "contact-1",
					e164: TO,
					source: "WEB_FORM",
					revokedAt: null,
				},
			],
			suppressions: [{ e164: TO, reason: "STOP_KEYWORD" }],
		});

		expect(await sms.send(request)).toEqual({
			status: "blocked",
			reason: "suppressed",
			retryAt: null,
		});
	});
});

describe("SmsInternalController", () => {
	function controller(secret: string | undefined) {
		const received: SmsSendRequest[] = [];
		const sms = {
			send: async (body: SmsSendRequest) => {
				received.push(body);
				return { status: "sent", telnyxId: "msg-1", dryRun: true };
			},
		} as unknown as SmsInternalService;
		const config = {
			get: () => secret,
		} as unknown as ConfigService<EnvironmentVariables, true>;
		return { received, controller: new SmsInternalController(sms, config) };
	}

	const body = JSON.stringify(request);

	it("answers 503 when the bridge secret is not set", async () => {
		const { controller: api } = controller(undefined);

		await expect(
			api.send(requestWith(body), `Bearer ${SECRET}`),
		).rejects.toMatchObject({ status: 503 });
	});

	it("answers 401 without the bearer and reads no body", async () => {
		const { controller: api, received } = controller(SECRET);

		await expect(api.send(requestWith(body))).rejects.toMatchObject({
			status: 401,
		});
		await expect(
			api.send(requestWith(body), "Bearer wrong"),
		).rejects.toMatchObject({ status: 401 });
		expect(received).toHaveLength(0);
	});

	it("answers 400 for a body that breaks the contract", async () => {
		const { controller: api } = controller(SECRET);

		await expect(
			api.send(
				requestWith(JSON.stringify({ ...request, to: "212" })),
				`Bearer ${SECRET}`,
			),
		).rejects.toMatchObject({ status: 400 });
		await expect(
			api.send(requestWith("not json"), `Bearer ${SECRET}`),
		).rejects.toMatchObject({ status: 400 });
	});

	it("answers 413 for a body over the limit", async () => {
		const { controller: api } = controller(SECRET);
		const huge = "x".repeat(SMS_INTERNAL.body.maxBytes + 1);

		await expect(
			api.send(requestWith(huge), `Bearer ${SECRET}`),
		).rejects.toMatchObject({ status: 413 });
	});

	it("hands a valid body to the service and returns its answer", async () => {
		const { controller: api, received } = controller(SECRET);

		const response = await api.send(requestWith(body), `Bearer ${SECRET}`);

		expect(response).toEqual({
			status: "sent",
			telnyxId: "msg-1",
			dryRun: true,
		});
		expect(received).toEqual([request]);
	});
});
