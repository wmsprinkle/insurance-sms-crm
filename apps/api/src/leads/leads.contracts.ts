import { z } from "zod";
import { LEAD_ROW_STATUSES } from "./lead-batch";
import { LEAD_FIELDS, leadColumnMapping } from "./lead-csv";
import { LEAD_REJECTIONS } from "./lead-validation";
import { LEADS } from "./leads-config";

const csvText = z
	.string()
	.min(1, "The CSV is empty.")
	.max(LEADS.csv.maxBytes, "The CSV is too large.");

export const leadImportPreviewInput = z.object({
	csv: csvText,
	mapping: z.partialRecord(z.enum(LEAD_FIELDS), z.string()).optional(),
});

export type LeadImportPreviewInput = z.infer<typeof leadImportPreviewInput>;

export const leadImportCommitInput = z.object({
	csv: csvText,
	mapping: leadColumnMapping,
});

export type LeadImportCommitInput = z.infer<typeof leadImportCommitInput>;

const rowResult = z.object({
	rowNumber: z.number().int(),
	phone: z.string().nullable(),
	status: z.enum(LEAD_ROW_STATUSES),
	reasons: z.array(z.enum(LEAD_REJECTIONS)),
	contactId: z.string().nullable(),
});

const totals = z.object({
	rows: z.number().int(),
	ready: z.number().int(),
	created: z.number().int(),
	duplicate: z.number().int(),
	rejected: z.number().int(),
});

export const leadImportOutput = z.object({
	headers: z.array(z.string()),
	mapping: z.partialRecord(z.enum(LEAD_FIELDS), z.string()),
	mappingIssues: z.array(z.string()),
	totals,
	rows: z.array(rowResult),
});

export type LeadImportOutput = z.infer<typeof leadImportOutput>;

const optionalText = z.string().max(LEADS.field.maxLength).nullish();

export const leadIngestBody = z.object({
	firstName: optionalText,
	lastName: optionalText,
	fullName: optionalText,
	email: optionalText,
	phone: z.string().max(LEADS.field.maxLength),
	consent: z.object({
		source: z.string().max(LEADS.field.maxLength),
		capturedAt: z.string().max(LEADS.field.maxLength),
		optInText: z.string().max(LEADS.field.maxOptInTextLength).nullish(),
		optInUrl: optionalText,
		ip: optionalText,
	}),
});

export type LeadIngestBody = z.infer<typeof leadIngestBody>;
