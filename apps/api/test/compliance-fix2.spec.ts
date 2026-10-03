import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setSystemTime,
} from "bun:test";
import type { Db } from "@crm/db";
import { smsSendRequest } from "@crm/validation/sms-send";
import { ConsentService } from "../src/compliance/consent.service";
import {
	optOutConfirmationKey,
	SendGateService,
} from "../src/compliance/send-gate";
import { SuppressionService } from "../src/compliance/suppression.service";
import { SmsDraftsService } from "../src/sms/drafts.service";
import { KeywordService } from "../src/sms/keyword.service";
import { RateLimiter } from "../src/sms/rate-limiter";
import { SMS_INTERNAL } from "../src/sms/sms-internal";
import { SmsInternalService } from "../src/sms/sms-internal.service";
import {
	SendOutcomeUnknownError,
	SmsSender,
} from "../src/sms/sms-sender.service";
import {
	type Fetcher,
	TelnyxClient,
	TelnyxSendError,
	TelnyxUnknownOutcomeError,
} from "../src/sms/telnyx.client";
import { fakeDb } from "./support/sms-db";

const PHONE = "+12125550123";
const OPEN = new Date("2026-10-05T17:00:00Z");
const contact = { id: "contact-1", phone: PHONE, archivedAt: null };
const consent = {
	id: "c1",
	contactId: "contact-1",
	e164: PHONE,
	source: "WEB_FORM",
	revokedAt: null,
};

const request = {
	contactId: "contact-1",
	to: PHONE,
	text: "Hi, it's the agency.",
	purpose: "conversation" as const,
	idempotencyKey: "task-1:reply-1",
	taskId: "task-1",
	dryRun: false,
};

const MINUTE_MS = 60_000;

function telnyxClient(fetcher: Fetcher, dryRun: boolean) {
	return new TelnyxClient(
		{
			apiKey: "key",
			publicKey: null,
			messagingProfileId: null,
			fromNumber: "+18005550100",
			messagesPerSecond: null,
			dryRun,
		},
		new RateLimiter(1000, 1000, { now: () => 0, sleep: async () => undefined }),
		fetcher,
	);
}

function stack(
	seed: Parameters<typeof fakeDb>[0],
	fetcher: Fetcher,
	dryRun = true,
) {
	const { state, db } = fakeDb({
		contacts: [contact],
		consents: [consent],
		...seed,
	});
	const client = db as unknown as Db;
	const gate = new SendGateService(
		client,
		new ConsentService(client),
		new SuppressionService(client),
	);
	const sender = new SmsSender(client, gate, telnyxClient(fetcher, dryRun));
	return {
		state,
		client,
		gate,
		sender,
		internal: new SmsInternalService(client, sender, sender),
	};
}

const never: Fetcher = (async () => {
	throw new Error("fetch must not run");
}) as unknown as Fetcher;

beforeEach(() => setSystemTime(OPEN));
afterEach(() => setSystemTime());

describe("R3: an unknown Telnyx outcome never releases the key", () => {
	const timeout = (async () => {
		throw new DOMException("timed out", "TimeoutError");
	}) as unknown as Fetcher;
	const noId = (async () =>
		new Response(JSON.stringify({ data: {} }), {
			status: 200,
		})) as unknown as Fetcher;

	it("turns a timeout into an unknown-outcome error, not a refusal", async () => {
		const client = telnyxClient(timeout, false);
		const error = await client.send({ to: PHONE, text: "Hi" }).catch((e) => e);

		expect(error).toBeInstanceOf(TelnyxUnknownOutcomeError);
		expect(error).not.toBeInstanceOf(TelnyxSendError);
	});

	it("turns a 2xx without an id into an unknown-outcome error", async () => {
		const client = telnyxClient(noId, false);

		await expect(client.send({ to: PHONE, text: "Hi" })).rejects.toBeInstanceOf(
			TelnyxUnknownOutcomeError,
		);
	});

	it("still treats a refusal as not sent", async () => {
		const refused = (async () =>
			new Response("{}", { status: 400 })) as unknown as Fetcher;
		const client = telnyxClient(refused, false);

		await expect(client.send({ to: PHONE, text: "Hi" })).rejects.toBeInstanceOf(
			TelnyxSendError,
		);
	});

	it("marks the receipt unknown after a timeout and refuses every retry of the key", async () => {
		const { internal, state } = stack({}, timeout, false);

		await expect(internal.send(request)).rejects.toBeInstanceOf(
			SendOutcomeUnknownError,
		);
		const receipt = state.events.find((row) => row.id.startsWith("sms-send:"));
		expect(receipt?.type).toBe(SMS_INTERNAL.idempotency.unknown);

		expect(await internal.send(request)).toEqual({
			status: "failed",
			error: SMS_INTERNAL.errors.unknownOutcome,
		});
		expect(state.sms).toHaveLength(0);
	});

	it("does not reclaim an unknown receipt after the stale lease", async () => {
		const { internal, state } = stack({}, timeout, false);
		await expect(internal.send(request)).rejects.toBeInstanceOf(
			SendOutcomeUnknownError,
		);
		setSystemTime(new Date(OPEN.getTime() + 60 * MINUTE_MS));

		expect(await internal.send(request)).toMatchObject({ status: "failed" });
		expect(
			state.events.find((row) => row.id.startsWith("sms-send:"))?.type,
		).toBe(SMS_INTERNAL.idempotency.unknown);
	});

	it("still releases the key when a refusal is definite", async () => {
		const refused = (async () =>
			new Response("{}", { status: 400 })) as unknown as Fetcher;
		const { internal, state } = stack({}, refused, false);

		expect(await internal.send(request)).toMatchObject({ status: "failed" });
		expect(
			state.events.find((row) => row.id.startsWith("sms-send:"))?.type,
		).toBe(SMS_INTERNAL.idempotency.released);
	});

	it("blocks a draft approve while the receipt is unknown, and sends nothing", async () => {
		const sends: unknown[] = [];
		const drafts = new SmsDraftsService(
			{
				smsDraft: {
					findUnique: async () => ({
						id: "d1",
						status: "PENDING",
						contactId: "contact-1",
						reason: "send-failed",
						taskId: "task-1",
						idempotencyKey: "task-1:reply-1",
						body: "Hi",
					}),
				},
				agentEvent: {
					findUnique: async () => ({ type: SMS_INTERNAL.idempotency.unknown }),
				},
			} as unknown as Db,
			{
				send: async (input: unknown) => {
					sends.push(input);
					return { status: "sent", telnyxId: "x", dryRun: false };
				},
			} as unknown as SmsInternalService,
		);

		const outcome = await drafts.approve({ draftId: "d1" }, "user-1");

		expect(outcome).toMatchObject({ status: "failed" });
		expect(sends).toHaveLength(0);
	});
});

describe("R4: the frequency cap counts sends that are still in flight", () => {
	const inFlight = (
		id: string,
		over: { type?: string; ageMs?: number; purpose?: string } = {},
	) => ({
		id: `sms-send:${id}`,
		sessionId: SMS_INTERNAL.idempotency.sessionId,
		contactId: "contact-1",
		type: over.type ?? SMS_INTERNAL.idempotency.claimed,
		data: { purpose: over.purpose ?? "conversation" },
		emittedAt: new Date(OPEN.getTime() - (over.ageMs ?? MINUTE_MS)),
	});

	const check = (events: ReturnType<typeof inFlight>[], receiptId?: string) => {
		const { gate } = stack({ events }, never);
		return gate.check({
			to: PHONE,
			contactId: "contact-1",
			purpose: "conversation",
			now: OPEN,
			receiptId,
		});
	};

	it("blocks when claimed sends fill the cap", async () => {
		const decision = await check([inFlight("a"), inFlight("b"), inFlight("c")]);

		expect(decision).toMatchObject({ allowed: false, reason: "frequency-cap" });
	});

	it("does not count its own receipt", async () => {
		const decision = await check(
			[inFlight("a"), inFlight("b"), inFlight("own")],
			"sms-send:own",
		);

		expect(decision.allowed).toBe(true);
	});

	it("ignores a stale claim, a keyword reply and other contacts", async () => {
		const stale = inFlight("a", {
			ageMs: SMS_INTERNAL.lease.claimMs + MINUTE_MS,
		});
		const keyword = inFlight("b", { purpose: "opt-out-confirmation" });
		const other = { ...inFlight("c"), contactId: "contact-2" };

		expect((await check([stale, keyword, other])).allowed).toBe(true);
	});

	it("counts an unknown-outcome receipt for the whole week", async () => {
		const unknown = (id: string) =>
			inFlight(id, {
				type: SMS_INTERNAL.idempotency.unknown,
				ageMs: 3 * 24 * 60 * MINUTE_MS,
			});
		const week = ["a", "b", "c", "d", "e", "f", "g"].map(unknown);

		expect(await check(week)).toMatchObject({
			allowed: false,
			reason: "frequency-cap",
		});
		expect((await check(week.slice(1))).allowed).toBe(true);
	});

	it("lets parallel sends through only up to the cap", async () => {
		const { internal, state } = stack({}, never);

		const results = await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				internal.send({ ...request, idempotencyKey: `parallel-${index}` }),
			),
		);

		const sent = results.filter((row) => row.status === "sent").length;
		expect(sent).toBeLessThanOrEqual(3);
		expect(
			state.sms.filter((row) => row.direction === "OUTBOUND"),
		).toHaveLength(sent);
	});

	it("lets one send through when nothing else is in flight", async () => {
		const { internal } = stack({}, never);

		expect((await internal.send(request)).status).toBe("sent");
	});

	it("rejects a send request without an idempotency key", () => {
		const { idempotencyKey: _key, ...rest } = request;

		expect(smsSendRequest.safeParse(rest).success).toBe(false);
		expect(
			smsSendRequest.safeParse({ ...rest, idempotencyKey: "  " }).success,
		).toBe(false);
	});
});

describe("R6: the opt-out confirmation is retried after a failed first send", () => {
	const suppressedAt = new Date(OPEN.getTime() - MINUTE_MS);
	const refused = (async () =>
		new Response("{}", { status: 503 })) as unknown as Fetcher;

	it("frees the claim when Telnyx refuses, so the retry sends", async () => {
		const { sender, state } = stack(
			{
				suppressions: [
					{ e164: PHONE, reason: "OPT_OUT_REQUEST", createdAt: suppressedAt },
				],
			},
			refused,
			false,
		);
		const first = await sender.send({
			to: PHONE,
			contactId: "contact-1",
			text: "unsubscribed",
			purpose: "opt-out-confirmation",
		});

		expect(first.status).toBe("failed");
		expect(
			state.events.some(
				(row) => row.id === optOutConfirmationKey(PHONE, suppressedAt),
			),
		).toBe(false);

		const retry = await stack(
			{
				suppressions: [
					{ e164: PHONE, reason: "OPT_OUT_REQUEST", createdAt: suppressedAt },
				],
			},
			never,
		).sender.send({
			to: PHONE,
			contactId: "contact-1",
			text: "unsubscribed",
			purpose: "opt-out-confirmation",
		});
		expect(retry.status).toBe("sent");
	});

	it("keeps the claim when the outcome is unknown", async () => {
		const timeout = (async () => {
			throw new DOMException("timed out", "TimeoutError");
		}) as unknown as Fetcher;
		const { sender, state } = stack(
			{
				suppressions: [
					{ e164: PHONE, reason: "OPT_OUT_REQUEST", createdAt: suppressedAt },
				],
			},
			timeout,
			false,
		);

		await expect(
			sender.send({
				to: PHONE,
				contactId: "contact-1",
				text: "unsubscribed",
				purpose: "opt-out-confirmation",
			}),
		).rejects.toBeInstanceOf(SendOutcomeUnknownError);
		expect(
			state.events.some(
				(row) => row.id === optOutConfirmationKey(PHONE, suppressedAt),
			),
		).toBe(true);
	});

	it("sends one confirmation when the first send works", async () => {
		const { sender } = stack(
			{
				suppressions: [
					{ e164: PHONE, reason: "OPT_OUT_REQUEST", createdAt: suppressedAt },
				],
			},
			never,
		);
		const send = () =>
			sender.send({
				to: PHONE,
				contactId: "contact-1",
				text: "unsubscribed",
				purpose: "opt-out-confirmation",
			});

		expect((await send()).status).toBe("sent");
		expect((await send()).status).toBe("blocked");
	});
});

describe("R7: START grants consent only to the matching contact with earlier history", () => {
	function keywords(seed: Parameters<typeof fakeDb>[0]) {
		const { state, db } = fakeDb({ contacts: [contact], ...seed });
		const client = db as unknown as Db;
		const consents = new ConsentService(client);
		const suppression = new SuppressionService(client);
		const gate = new SendGateService(client, consents, suppression);
		const sender = new SmsSender(client, gate, telnyxClient(never, true));
		return {
			state,
			service: new KeywordService(client, consents, suppression, sender),
		};
	}

	const start = (contactId: string | null) => ({
		keyword: "start" as const,
		from: PHONE,
		contactId,
		message: {
			kind: "received" as const,
			eventId: "e1",
			telnyxId: "t1",
			from: PHONE,
			to: "+18005550100",
			text: "START",
		},
	});

	it("grants nothing to a number that never had consent or an opt-out", async () => {
		const { service, state } = keywords({});
		await service.handle(start("contact-1"));

		expect(state.consents).toHaveLength(0);
	});

	it("grants after a STOP lifted the suppression", async () => {
		const { service, state } = keywords({
			suppressions: [{ e164: PHONE, reason: "STOP_KEYWORD" }],
		});
		await service.handle(start("contact-1"));

		expect(state.consents).toHaveLength(1);
		expect(state.consents[0]).toMatchObject({
			contactId: "contact-1",
			e164: PHONE,
			source: "SMS_KEYWORD",
		});
	});

	it("grants after an earlier consent that was revoked", async () => {
		const { service, state } = keywords({
			consents: [{ ...consent, revokedAt: new Date(0) }],
		});
		await service.handle(start("contact-1"));

		expect(state.consents.filter((row) => row.revokedAt === null)).toHaveLength(
			1,
		);
	});

	it("grants nothing when the contact's phone is not the sender", async () => {
		const { service, state } = keywords({
			contacts: [{ ...contact, phone: "+12125550999" }],
			suppressions: [{ e164: PHONE, reason: "STOP_KEYWORD" }],
		});
		await service.handle(start("contact-1"));

		expect(state.consents).toHaveLength(0);
	});

	it("does not lift a wrong-number suppression and grants nothing", async () => {
		const { service, state } = keywords({
			suppressions: [{ e164: PHONE, reason: "WRONG_NUMBER" }],
		});
		await service.handle(start("contact-1"));

		expect(state.suppressions).toHaveLength(1);
		expect(state.consents).toHaveLength(0);
	});
});
