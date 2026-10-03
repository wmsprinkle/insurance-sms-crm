import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import { SmsStatus } from "@crm/db/enums";
import type { SmsEnv } from "@crm/env/sms";
import { ConsentService } from "../src/compliance/consent.service";
import { SendGateService } from "../src/compliance/send-gate";
import { SuppressionService } from "../src/compliance/suppression.service";
import { RateLimiter } from "../src/sms/rate-limiter";
import { SmsSender } from "../src/sms/sms-sender.service";
import { type Fetcher, TelnyxClient } from "../src/sms/telnyx.client";
import { fakeDb } from "./support/sms-db";

const env: SmsEnv = {
	apiKey: "test-key",
	publicKey: null,
	messagingProfileId: null,
	fromNumber: "+18005550100",
	messagesPerSecond: null,
	dryRun: true,
};

const noSleep = { now: () => 0, sleep: async () => undefined };

function sender(
	seed: Parameters<typeof fakeDb>[0],
	options: { dryRun?: boolean; status?: number } = {},
) {
	const { state, db } = fakeDb(seed);
	const client = db as unknown as Db;
	let calls = 0;
	const fetcher = (async () => {
		calls += 1;
		return new Response(
			JSON.stringify(
				options.status === 200 || options.status === undefined
					? { data: { id: "msg-live" } }
					: { errors: [{ code: "40300" }] },
			),
			{ status: options.status ?? 200 },
		);
	}) as unknown as Fetcher;
	const telnyx = new TelnyxClient(
		{ ...env, dryRun: options.dryRun ?? true },
		new RateLimiter(10, 10, noSleep),
		fetcher,
	);
	const gate = new SendGateService(
		client,
		new ConsentService(client),
		new SuppressionService(client),
	);
	return {
		state,
		calls: () => calls,
		sms: new SmsSender(client, gate, telnyx),
	};
}

const consented = {
	consents: [
		{
			id: "c1",
			contactId: "contact-1",
			e164: "+12125550123",
			source: "WEB_FORM",
			revokedAt: null,
		},
	],
};

const message = {
	to: "+12125550123",
	contactId: "contact-1",
	text: "Hi, it's the agency.",
	purpose: "conversation" as const,
};

describe("SmsSender", () => {
	it("sends nothing and records nothing when the gate blocks", async () => {
		const { sms, state, calls } = sender({});

		const outcome = await sms.send(message);

		expect(outcome.status).toBe("blocked");
		expect(calls()).toBe(0);
		expect(state.sms).toHaveLength(0);
	});

	it("records a dry-run send as sent with the fake id", async () => {
		const { sms, state } = sender(consented);

		const outcome = await sms.send(message);

		if (outcome.status !== "sent") throw new Error(outcome.status);
		expect(outcome.dryRun).toBe(true);
		expect(state.sms).toMatchObject([
			{
				direction: "OUTBOUND",
				telnyxId: outcome.telnyxId,
				status: SmsStatus.SENT,
			},
		]);
	});

	it("records a live send as sending until Telnyx reports back", async () => {
		const { sms, state } = sender(consented, { dryRun: false });

		await sms.send(message);

		expect(state.sms[0]).toMatchObject({
			telnyxId: "msg-live",
			status: SmsStatus.SENDING,
		});
	});

	it("records a refused send as failed with the Telnyx code", async () => {
		const { sms, state } = sender(consented, { dryRun: false, status: 422 });

		const outcome = await sms.send(message);

		expect(outcome.status).toBe("failed");
		expect(state.sms[0]).toMatchObject({
			status: SmsStatus.SENDING_FAILED,
			errorCode: "40300",
		});
	});
});
