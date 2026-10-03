import type { RouterInputs, RouterOutputs } from "@/lib/trpc/types";

type ImportOutput = RouterOutputs["leads"]["importPreview"];

export type LeadMapping = ImportOutput["mapping"];

export type LeadField = keyof RouterInputs["leads"]["importCommit"]["mapping"];

export type LeadRow = ImportOutput["rows"][number];

export type LeadRejection = LeadRow["reasons"][number];

type LeadRowStatus = LeadRow["status"];

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
	missing_phone: "This row has no phone number, so we cannot text this person.",
	invalid_phone:
		"We cannot read this phone number. Use a US number with 10 digits.",
	invalid_email:
		"This email address does not look right. Fix it or leave it empty.",
	missing_consent_source:
		"We cannot tell where this person agreed to be texted. Add a consent source.",
	invalid_consent_source:
		"The consent source is not one we know. Use WEB_FORM, LEAD_IMPORT, API, SMS_KEYWORD or MANUAL.",
	missing_consent_date:
		"We cannot tell when this person agreed to be texted. Add the date.",
	invalid_consent_date:
		"We cannot read the consent date. Use a format like 2026-09-30.",
	consent_date_in_future:
		"The consent date is in the future. Consent must come before the import.",
	missing_opt_in_evidence:
		"No proof of what they agreed to. Add the opt-in text or the page they signed up on.",
	invalid_opt_in_url:
		"The opt-in page link must start with http:// or https://.",
	field_too_long: "One value in this row is too long. Shorten it.",
	duplicate_in_batch: "The same person appears earlier in this file.",
	duplicate_phone: "A lead in your CRM already has this phone number.",
	duplicate_email: "A lead in your CRM already has this email address.",
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

export const IMPORT_STEPS = [
	{ id: "upload", label: "Upload" },
	{ id: "map", label: "Match columns" },
	{ id: "review", label: "Review & import" },
] as const;

export type ImportStepId = (typeof IMPORT_STEPS)[number]["id"];

export type ImportStepState = "done" | "current" | "upcoming";

export function stepStates(current: ImportStepId): {
	id: ImportStepId;
	label: string;
	number: number;
	state: ImportStepState;
}[] {
	const index = IMPORT_STEPS.findIndex((step) => step.id === current);
	return IMPORT_STEPS.map((step, position) => ({
		...step,
		number: position + 1,
		state:
			position < index ? "done" : position === index ? "current" : "upcoming",
	}));
}

export function currentStep(input: {
	hasFile: boolean;
	hasPreview: boolean;
	wantsReview: boolean;
}): ImportStepId {
	if (!input.hasFile) return "upload";
	if (input.wantsReview && input.hasPreview) return "review";
	return "map";
}

export function mappingBlockers(mapping: LeadMapping): string[] {
	const missing = missingRequiredFields(mapping);
	const blockers = LEAD_FIELD_OPTIONS.filter((option) =>
		missing.includes(option.field),
	).map(
		(option) => `Pick the column that holds the ${option.label.toLowerCase()}.`,
	);
	if (!hasOptInEvidence(mapping)) {
		blockers.push(
			"Pick the column with the opt-in text, the opt-in page link, or both.",
		);
	}
	return blockers;
}

export function importBlockReason(ready: number): string | null {
	return ready === 0
		? "No row is ready. Fix the problems in your file and upload it again."
		: null;
}

export function importLabel(count: number): string {
	return count === 1 ? "Import 1 lead" : `Import ${count} leads`;
}

export function problemRows(rows: readonly LeadRow[]): LeadRow[] {
	return rows.filter(
		(row) => row.status === "rejected" || row.status === "duplicate",
	);
}

type VisibleRows = { shown: LeadRow[]; total: number };

export function visibleRows(
	rows: readonly LeadRow[],
	onlyProblems: boolean,
	limit: number = LEAD_IMPORT.previewRows,
): VisibleRows {
	const pool = onlyProblems ? problemRows(rows) : rowsForReview(rows);
	return {
		shown: rowsForReview(pool).slice(0, limit),
		total: pool.length,
	};
}
