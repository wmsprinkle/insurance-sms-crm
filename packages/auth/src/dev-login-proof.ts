import { createHmac, timingSafeEqual } from "node:crypto";

export const DEV_LOGIN_PROOF_HEADER = "x-crm-dev-login-proof";

const PROOF_MESSAGE = "crm-dev-login-v1";

export function createDevLoginProof(secret: string): string {
	return createHmac("sha256", secret).update(PROOF_MESSAGE).digest("hex");
}

export function verifyDevLoginProof(
	secret: string | undefined,
	proof: string | null | undefined,
): boolean {
	if (!secret || !proof) return false;

	const expected = Buffer.from(createDevLoginProof(secret));
	const given = Buffer.from(proof);

	return given.length === expected.length && timingSafeEqual(given, expected);
}
