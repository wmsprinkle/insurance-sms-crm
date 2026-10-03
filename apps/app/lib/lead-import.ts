import type { RouterInputs, RouterOutputs } from "@/lib/trpc/types";

type ImportOutput = RouterOutputs["leads"]["importPreview"];

export type LeadMapping = ImportOutput["mapping"];

export type LeadField = keyof RouterInputs["leads"]["importCommit"]["mapping"];

export type LeadRow = ImportOutput["rows"][number];

export type LeadRejection = LeadRow["reasons"][number];

export type LeadRowStatus = LeadRow["status"];

const KIB = 1_024;
const MIB = 1_024 * KIB;

export const LEAD_IMPORT = {
	maxBytes: 5 * MIB,
	previewRows: 200,
} as const;

export const LEAD_FIELD_OPTIONS: readonly {
	field: LeadField;
	label: string;
	required: boolean;
}[] = [
	{ field: "phone", label: "Phone", required: true },
	{ field: "firstName", label: "First name", required: false },
	{ field: "lastName", label: "Last name", required: false },
	{ field: "fullName", label: "Full name", required: false },
	{ field: "email", label: "Email", required: false },
	{ field: "consentSource", label: "Consent source", required: true },
	{ field: "consentCapturedAt", label: "Consent date", required: true },
	{ field: "optInText", label: "Opt-in text", required: false },
	{ field: "optInUrl", label: "Opt-in URL", required: false },
	{ field: "consentIp", label: "Consent IP address", required: false },
];

const REJECTION_LABELS = {
	missing_phone: "No phone number",
	invalid_phone: "Phone number is not valid",
	invalid_email: "Email is not valid",
	missing_consent_source: "No consent source",
	invalid_consent_source: "Consent source is not a known value",
	missing_consent_date: "No consent date",
	invalid_consent_date: "Consent date cannot be read",
	consent_date_in_future: "Consent date is in the future",
	missing_opt_in_evidence: "No opt-in text or opt-in URL",
	invalid_opt_in_url: "Opt-in URL is not http or https",
	field_too_long: "A value is too long",
	duplicate_in_batch: "Same lead appears earlier in this file",
	duplicate_phone: "A contact already has this phone number",
	duplicate_email: "A contact already has this email",
} satisfies Record<LeadRejection, string>;

export function rejectionLabel(reason: LeadRejection): string {
	return REJECTION_LABELS[reason];
}

const STATUS_ORDER = {
	rejected: 0,
	duplicate: 1,
	ready: 2,
	created: 3,
} satisfies Record<LeadRowStatus, number>;

export function rowsForReview(rows: readonly LeadRow[]): LeadRow[] {
	return [...rows].sort(
		(a, b) =>
			STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
			a.rowNumber - b.rowNumber,
	);
}

export function missingRequiredFields(mapping: LeadMapping): LeadField[] {
	return LEAD_FIELD_OPTIONS.filter(
		(option) => option.required && !mapping[option.field]?.trim(),
	).map((option) => option.field);
}

export function hasOptInEvidence(mapping: LeadMapping): boolean {
	return Boolean(mapping.optInText?.trim() || mapping.optInUrl?.trim());
}

export function withColumn(
	mapping: LeadMapping,
	field: LeadField,
	header: string | null,
): LeadMapping {
	const next = { ...mapping };
	if (header) {
		next[field] = header;
	} else {
		delete next[field];
	}
	return next;
}

export function commitMapping(
	mapping: LeadMapping,
): RouterInputs["leads"]["importCommit"]["mapping"] | null {
	const { phone, consentSource, consentCapturedAt } = mapping;
	if (!phone || !consentSource || !consentCapturedAt) return null;
	if (!hasOptInEvidence(mapping)) return null;
	return { ...mapping, phone, consentSource, consentCapturedAt };
}
