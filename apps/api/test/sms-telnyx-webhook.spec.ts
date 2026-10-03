import { describe, expect, it } from "bun:test";
import { SmsStatus } from "@crm/db/enums";
import type { SmsService } from "../src/sms/sms.service";
import {
	parseTelnyxEvent,
	statusesBelow,
	type TelnyxInbound,
	type TelnyxStatusUpdate,
} from "../src/sms/telnyx-event";
import {
	telnyxPublicKey,
	verifyTelnyxSignature,
} from "../src/sms/telnyx-signature";
import { TelnyxWebhookController } from "../src/sms/telnyx-webhook.controller";
import {
	nowSeconds,
	requestWith,
	signTelnyx,
	telnyxBody,
	testKeys,
} from "./support/sms-fakes";

const keys = testKeys();
const publicKey = telnyxPublicKey(keys.publicKeyBase64);
const WINDOW_MS = 300_000;

describe("telnyxPublicKey", () => {
	it("reads a base64 raw Ed25519 key and rejects anything else", () => {
		expect(publicKey).not.toBeNull();
		expect(telnyxPublicKey(null)).toBeNull();
		expect(telnyxPublicKey("bm90IGEga2V5")).toBeNull();
	});
});

describe("verifyTelnyxSignature", () => {
	const body = telnyxBody({ eventType: "message.received" });
	const timestamp = "1790000000";
	const nowMs = 1_790_000_000_000;
	const signature = signTelnyx(keys.privateKey, timestamp, body);

	function check(
		overrides: Partial<{
			body: string;
			signature: string | undefined;
			timestamp: string | undefined;
			nowMs: number;
		}>,
	) {
		if (!publicKey) throw new Error("test key did not load");
		return verifyTelnyxSignature(
			{
				rawBody: Buffer.from(overrides.body ?? body),
				signature: "signature" in overrides ? overrides.signature : signature,
				timestamp: "timestamp" in overrides ? overrides.timestamp : timestamp,
			},
			publicKey,
			{ nowMs: overrides.nowMs ?? nowMs, windowMs: WINDOW_MS },
		);
	}

	it("accepts a signature over timestamp|raw body", () => {
		expect(check({})).toBe("valid");
	});

	it("rejects a body changed by one byte", () => {
		expect(check({ body: body.replace("Hello", "Hellp") })).toBe("invalid");
	});

	it("rejects a signature from another key", () => {
		const other = testKeys();
		expect(
			check({ signature: signTelnyx(other.privateKey, timestamp, body) }),
		).toBe("invalid");
	});

	it("rejects a replay outside the 300 s window, either side", () => {
		expect(check({ nowMs: nowMs + WINDOW_MS })).toBe("valid");
		expect(check({ nowMs: nowMs + WINDOW_MS + 1_000 })).toBe("stale");
		expect(check({ nowMs: nowMs - WINDOW_MS - 1_000 })).toBe("stale");
	});

	it("reports missing headers and garbage timestamps", () => {
		expect(check({ signature: undefined })).toBe("missing");
		expect(check({ timestamp: undefined })).toBe("missing");
		expect(check({ timestamp: "soon" })).toBe("invalid");
		expect(check({ signature: "not-base64!!" })).toBe("invalid");
	});
});

describe("parseTelnyxEvent", () => {
	it("reads an inbound message", () => {
		expect(
			parseTelnyxEvent(
				telnyxBody({
					eventType: "message.received",
					telnyxId: "in-1",
					text: "Is this still available?",
				}),
			),
		).toEqual({
			kind: "received",
			eventId: "evt-1",
			telnyxId: "in-1",
			from: "+15125550123",
			to: "+18005550100",
			text: "Is this still available?",
		});
	});

	it("maps delivery receipts to our statuses", () => {
		expect(
			parseTelnyxEvent(
				telnyxBody({
					eventType: "message.finalized",
					status: "delivery_failed",
					errorCode: "40001",
				}),
			),
		).toMatchObject({
			kind: "status",
			status: SmsStatus.DELIVERY_FAILED,
			errorCode: "40001",
		});
		expect(
			parseTelnyxEvent(
				telnyxBody({ eventType: "message.sent", status: "sent" }),
			),
		).toMatchObject({
			kind: "status",
			status: SmsStatus.SENT,
			errorCode: null,
		});
	});

	it("ignores event types and statuses it does not handle", () => {
		expect(
			parseTelnyxEvent(telnyxBody({ eventType: "number_order.complete" })),
		).toMatchObject({ kind: "ignored" });
		expect(
			parseTelnyxEvent(
				telnyxBody({ eventType: "message.sent", status: "odd" }),
			),
		).toMatchObject({ kind: "ignored" });
	});

	it("throws a readable error for bodies that are not Telnyx events", () => {
		expect(() => parseTelnyxEvent("not json")).toThrow("not JSON");
		expect(() => parseTelnyxEvent("{}")).toThrow("Not a Telnyx event");
		expect(() =>
			parseTelnyxEvent(
				JSON.stringify({
					data: { id: "e", event_type: "message.received", payload: {} },
				}),
			),
		).toThrow("Unreadable message.received event");
	});
});

describe("statusesBelow", () => {
	it("never lets a late receipt downgrade a final status", () => {
		expect(statusesBelow(SmsStatus.SENT)).toEqual([
			SmsStatus.QUEUED,
			SmsStatus.SENDING,
		]);
		expect(statusesBelow(SmsStatus.DELIVERED)).not.toContain(
			SmsStatus.DELIVERY_FAILED,
		);
		expect(statusesBelow(SmsStatus.QUEUED)).toEqual([]);
	});
});

describe("TelnyxWebhookController", () => {
	type Calls = { received: TelnyxInbound[]; statuses: TelnyxStatusUpdate[] };

	function controller(key = publicKey) {
		const calls: Calls = { received: [], statuses: [] };
		const sms = {
			receive: async (event: TelnyxInbound) => {
				calls.received.push(event);
				return "stored" as const;
			},
			updateStatus: async (event: TelnyxStatusUpdate) => {
				calls.statuses.push(event);
				return "updated" as const;
			},
		};
		return {
			calls,
			controller: new TelnyxWebhookController(
				sms as unknown as SmsService,
				key,
			),
		};
	}

	function signed(body: string, offsetSeconds = 0) {
		const timestamp = nowSeconds(offsetSeconds);
		return {
			request: requestWith(body),
			signature: signTelnyx(keys.privateKey, timestamp, body),
			timestamp,
		};
	}

	it("verifies and hands an inbound message to the service", async () => {
		const { controller: webhook, calls } = controller();
		const body = telnyxBody({ eventType: "message.received" });
		const { request, signature, timestamp } = signed(body);

		await expect(
			webhook.receive(request, signature, timestamp),
		).resolves.toEqual({ event: "received", outcome: "stored" });
		expect(calls.received).toHaveLength(1);
	});

	it("hands delivery receipts to the status update", async () => {
		const { controller: webhook, calls } = controller();
		const body = telnyxBody({
			eventType: "message.finalized",
			status: "delivered",
		});
		const { request, signature, timestamp } = signed(body);

		await webhook.receive(request, signature, timestamp);

		expect(calls.statuses[0]?.status).toBe(SmsStatus.DELIVERED);
	});

	it("answers 401 for a bad or stale signature and touches nothing", async () => {
		const { controller: webhook, calls } = controller();
		const body = telnyxBody({ eventType: "message.received" });
		const stale = signed(body, -301);

		await expect(
			webhook.receive(stale.request, stale.signature, stale.timestamp),
		).rejects.toMatchObject({ status: 401 });

		const fresh = signed(body);
		await expect(
			webhook.receive(
				requestWith(`${body} `),
				fresh.signature,
				fresh.timestamp,
			),
		).rejects.toMatchObject({ status: 401 });

		expect(calls.received).toHaveLength(0);
	});

	it("answers 400 for a signed body that is not a Telnyx event", async () => {
		const { controller: webhook } = controller();
		const { request, signature, timestamp } = signed("{}");

		await expect(
			webhook.receive(request, signature, timestamp),
		).rejects.toMatchObject({ status: 400 });
	});

	it("answers 503 when no public key is configured", async () => {
		const { controller: webhook } = controller(null);
		const { request, signature, timestamp } = signed("{}");

		await expect(
			webhook.receive(request, signature, timestamp),
		).rejects.toMatchObject({ status: 503 });
	});
});

describe("clipInbound", () => {
	it("keeps normal text and clips a huge message by code point", async () => {
		const { clipInbound, MAX_INBOUND_CHARS } = await import(
			"../src/sms/telnyx-event"
		);
		expect(clipInbound("STOP")).toBe("STOP");
		const huge = "😀".repeat(MAX_INBOUND_CHARS + 500);
		expect(Array.from(clipInbound(huge)).length).toBe(MAX_INBOUND_CHARS);
	});
});
