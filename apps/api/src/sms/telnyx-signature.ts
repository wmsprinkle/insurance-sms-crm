import { createPublicKey, type KeyObject, verify } from "node:crypto";

export type SignatureCheck = "valid" | "missing" | "stale" | "invalid";

export type SignedRequest = {
	rawBody: Buffer;
	signature: string | undefined;
	timestamp: string | undefined;
};

const ED25519_KEY_BYTES = 32;

export function telnyxPublicKey(base64: string | null): KeyObject | null {
	if (!base64) return null;

	const bytes = Buffer.from(base64, "base64");
	if (bytes.length !== ED25519_KEY_BYTES) return null;

	try {
		return createPublicKey({
			key: { kty: "OKP", crv: "Ed25519", x: bytes.toString("base64url") },
			format: "jwk",
		});
	} catch {
		return null;
	}
}

export function verifyTelnyxSignature(
	request: SignedRequest,
	publicKey: KeyObject,
	options: { nowMs: number; windowMs: number },
): SignatureCheck {
	const { signature, timestamp } = request;
	if (!signature || !timestamp) return "missing";
	if (!/^\d{1,12}$/.test(timestamp)) return "invalid";

	const signedAtMs = Number(timestamp) * 1_000;
	if (Math.abs(options.nowMs - signedAtMs) > options.windowMs) return "stale";

	const signed = Buffer.concat([
		Buffer.from(`${timestamp}|`, "utf8"),
		request.rawBody,
	]);

	try {
		return verify(null, signed, publicKey, Buffer.from(signature, "base64"))
			? "valid"
			: "invalid";
	} catch {
		return "invalid";
	}
}
