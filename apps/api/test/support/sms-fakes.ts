import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";

export type TestKeys = { privateKey: KeyObject; publicKeyBase64: string };

export function testKeys(): TestKeys {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const jwk = publicKey.export({ format: "jwk" });
	return {
		privateKey,
		publicKeyBase64: Buffer.from(jwk.x ?? "", "base64url").toString("base64"),
	};
}

export function signTelnyx(
	privateKey: KeyObject,
	timestamp: string,
	body: string,
): string {
	return sign(null, Buffer.from(`${timestamp}|${body}`), privateKey).toString(
		"base64",
	);
}

export function requestWith(body: string): IncomingMessage {
	return Readable.from([Buffer.from(body)]) as IncomingMessage;
}

export function nowSeconds(offsetSeconds = 0): string {
	return String(Math.floor(Date.now() / 1_000) + offsetSeconds);
}

export type TelnyxBodyInput = {
	eventType: string;
	telnyxId?: string;
	from?: string;
	to?: string;
	text?: string;
	status?: string;
	errorCode?: string;
};

export function telnyxBody(input: TelnyxBodyInput): string {
	return JSON.stringify({
		data: {
			id: "evt-1",
			event_type: input.eventType,
			occurred_at: "2026-10-03T14:00:00.000Z",
			payload: {
				id: input.telnyxId ?? "msg-1",
				direction:
					input.eventType === "message.received" ? "inbound" : "outbound",
				from: { phone_number: input.from ?? "+15125550123" },
				to: [
					{
						phone_number: input.to ?? "+18005550100",
						status: input.status,
					},
				],
				text: input.text ?? "Hello",
				errors: input.errorCode ? [{ code: input.errorCode }] : [],
			},
		},
		meta: { attempt: 1 },
	});
}
