import { z } from "zod";

// E.164: "+", a country code that does not start with 0, at most 15 digits.
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export const e164 = z.string().regex(E164_PATTERN, "Not an E.164 number.");

// Normalises a typed or imported number to E.164. Numbers without a "+" are
// read as North American (country code 1), the only market this CRM texts.
// Returns null for anything that cannot be a phone number.
export function toE164(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const digits = trimmed.replace(/\D/g, "");
	let candidate: string;

	if (trimmed.startsWith("+")) candidate = `+${digits}`;
	else if (trimmed.startsWith("00")) candidate = `+${digits.slice(2)}`;
	else if (digits.length === 10) candidate = `+1${digits}`;
	else if (digits.length === 11 && digits.startsWith("1"))
		candidate = `+${digits}`;
	else return null;

	return E164_PATTERN.test(candidate) ? candidate : null;
}
