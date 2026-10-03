import { ConsentSource } from "@crm/db/enums";
import { toE164 } from "@crm/validation/phone";
import { z } from "zod";
import { LEADS } from "./leads-config";

export const LEAD_REJECTIONS = [
	"missing_phone",
	"invalid_phone",
	"invalid_email",
	"missing_consent_source",
	"invalid_consent_source",
	"missing_consent_date",
	"invalid_consent_date",
	"consent_date_in_future",
	"missing_opt_in_evidence",
	"invalid_opt_in_url",
	"field_too_long",
	"duplicate_in_batch",
	"duplicate_phone",
	"duplicate_email",
] as const;

export type LeadRejection = (typeof LEAD_REJECTIONS)[number];

export type RawLead = {
	firstName?: string | null;
	lastName?: string | null;
	fullName?: string | null;
	email?: string | null;
	phone?: string | null;
	consentSource?: string | null;
	consentCapturedAt?: string | null;
	optInText?: string | null;
	optInUrl?: string | null;
	consentIp?: string | null;
};

export type LeadConsent = {
	source: ConsentSource;
	capturedAt: Date;
	optInText: string | null;
	optInUrl: string | null;
	ip: string | null;
};

export type LeadCandidate = {
	firstName: string;
	lastName: string | null;
	email: string | null;
	phone: string;
	consent: LeadConsent;
};

export type LeadCheck =
	| { ok: true; lead: LeadCandidate }
	| { ok: false; reasons: LeadRejection[] };

const CONSENT_SOURCES = Object.values(ConsentSource);

const emailFormat = z.email();

const optInUrlFormat = z.url({ protocol: /^https?$/ });

export function checkLead(raw: RawLead, now: Date = new Date()): LeadCheck {
	const reasons: LeadRejection[] = [];
	const text = (value: string | null | undefined) => blank(value);

	const tooLong = [
		raw.firstName,
		raw.lastName,
		raw.fullName,
		raw.email,
		raw.phone,
		raw.consentSource,
		raw.consentCapturedAt,
		raw.optInUrl,
		raw.consentIp,
	].some((value) => (value?.length ?? 0) > LEADS.field.maxLength);
	if (
		tooLong ||
		(raw.optInText?.length ?? 0) > LEADS.field.maxOptInTextLength
	) {
		reasons.push("field_too_long");
	}

	const rawPhone = text(raw.phone);
	const phone = rawPhone ? toE164(rawPhone) : null;
	if (!rawPhone) reasons.push("missing_phone");
	else if (!phone) reasons.push("invalid_phone");

	const email = text(raw.email)?.toLowerCase() ?? null;
	if (email && !emailFormat.safeParse(email).success) {
		reasons.push("invalid_email");
	}

	const source = consentSource(text(raw.consentSource));
	if (source === "missing") reasons.push("missing_consent_source");
	else if (source === "invalid") reasons.push("invalid_consent_source");

	const capturedAt = consentDate(text(raw.consentCapturedAt), now);
	if (capturedAt === "missing") reasons.push("missing_consent_date");
	else if (capturedAt === "invalid") reasons.push("invalid_consent_date");
	else if (capturedAt === "future") reasons.push("consent_date_in_future");

	const optInText = text(raw.optInText);
	const optInUrl = text(raw.optInUrl);
	if (!optInText && !optInUrl) reasons.push("missing_opt_in_evidence");
	if (optInUrl && !optInUrlFormat.safeParse(optInUrl).success) {
		reasons.push("invalid_opt_in_url");
	}

	if (
		reasons.length > 0 ||
		!phone ||
		!(capturedAt instanceof Date) ||
		source === "missing" ||
		source === "invalid"
	) {
		return { ok: false, reasons };
	}

	const name = personName(raw, phone);

	return {
		ok: true,
		lead: {
			firstName: name.firstName,
			lastName: name.lastName,
			email,
			phone,
			consent: {
				source,
				capturedAt,
				optInText,
				optInUrl,
				ip: text(raw.consentIp),
			},
		},
	};
}

function blank(value: string | null | undefined): string | null {
	const trimmed = value?.trim() ?? "";
	return trimmed === "" ? null : trimmed;
}

function consentSource(
	value: string | null,
): ConsentSource | "missing" | "invalid" {
	if (!value) return "missing";
	const key = value.toUpperCase().replace(/[\s-]+/g, "_");
	const match = CONSENT_SOURCES.find((source) => source === key);
	return match ?? "invalid";
}

function consentDate(
	value: string | null,
	now: Date,
): Date | "missing" | "invalid" | "future" {
	if (!value) return "missing";
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return "invalid";
	if (parsed.getTime() > now.getTime() + LEADS.consent.clockSkewMs) {
		return "future";
	}
	return parsed;
}

type PersonName = Pick<LeadCandidate, "firstName" | "lastName">;

function personName(raw: RawLead, phone: string): PersonName {
	const firstName = blank(raw.firstName);
	const lastName = blank(raw.lastName);
	if (firstName) return { firstName, lastName };

	const parts = blank(raw.fullName)?.split(/\s+/) ?? [];
	const [first, ...rest] = parts;
	if (first) {
		return { firstName: first, lastName: blank(rest.join(" ")) ?? lastName };
	}

	return { firstName: phone, lastName };
}
