import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { LEADS } from "./leads-config";

export const LEAD_SOURCE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const SIGNATURE_PREFIX = "sha256=";

const secretEntry = z
	.string()
	.trim()
	.transform((entry, context) => {
		const separator = entry.indexOf(":");
		const source = entry.slice(0, separator).trim();
		const secret = entry.slice(separator + 1).trim();

		if (separator < 1 || !LEAD_SOURCE_PATTERN.test(source)) {
			context.addIssue({
				code: "custom",
				message: `"${source || entry.slice(0, 20)}" is not a valid lead source id.`,
			});
			return z.NEVER;
		}
		if (secret.length < LEADS.ingest.minSecretLength) {
			context.addIssue({
				code: "custom",
				message: `The secret for "${source}" is shorter than ${LEADS.ingest.minSecretLength} characters.`,
			});
			return z.NEVER;
		}
		return [source, secret] as const;
	});

export type LeadSourceSecrets = ReadonlyMap<string, string>;

export function parseLeadSourceSecrets(
	value: string | undefined,
): LeadSourceSecrets {
	const entries = (value ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");

	const parsed = z.array(secretEntry).safeParse(entries);
	if (!parsed.success) {
		throw new Error(
			`LEAD_INGEST_SECRETS is malformed: ${parsed.error.issues.map((issue) => issue.message).join(" ")}`,
		);
	}

	return new Map(parsed.data);
}

export function signLeadBody(
	secret: string,
	timestamp: string,
	body: string,
): string {
	return `${SIGNATURE_PREFIX}${createHmac("sha256", secret)
		.update(`${timestamp}.${body}`)
		.digest("hex")}`;
}

export type SignatureCheck = {
	secrets: LeadSourceSecrets;
	source: string | undefined;
	timestamp: string | undefined;
	signature: string | undefined;
	body: string;
	now: number;
};

export function verifyLeadSignature(check: SignatureCheck): boolean {
	const { source, timestamp, signature } = check;
	if (!source || !timestamp || !signature) return false;

	const secret = check.secrets.get(source);
	if (!secret) return false;

	if (!/^\d{1,12}$/.test(timestamp)) return false;
	const sentAt = Number(timestamp) * 1_000;
	if (Math.abs(check.now - sentAt) > LEADS.ingest.signatureToleranceMs) {
		return false;
	}

	const expected = Buffer.from(signLeadBody(secret, timestamp, check.body));
	const given = Buffer.from(signature.trim().toLowerCase());

	return expected.length === given.length && timingSafeEqual(expected, given);
}
