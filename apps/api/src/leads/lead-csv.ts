import { z } from "zod";
import type { CsvTable } from "./csv";
import type { RawLead } from "./lead-validation";

export const LEAD_FIELDS = [
	"phone",
	"firstName",
	"lastName",
	"fullName",
	"email",
	"consentSource",
	"consentCapturedAt",
	"optInText",
	"optInUrl",
	"consentIp",
] as const satisfies readonly (keyof RawLead)[];

export type LeadField = (typeof LEAD_FIELDS)[number];

const column = z.string().trim().min(1);

const OPT_IN_EVIDENCE_ISSUE =
	"Map an opt-in text column, an opt-in URL column, or both.";

function hasOptInEvidence(mapping: {
	optInText?: string;
	optInUrl?: string;
}): boolean {
	return Boolean(mapping.optInText?.trim() || mapping.optInUrl?.trim());
}

export const leadColumnMapping = z
	.object({
		phone: column,
		firstName: column.optional(),
		lastName: column.optional(),
		fullName: column.optional(),
		email: column.optional(),
		consentSource: column,
		consentCapturedAt: column,
		optInText: column.optional(),
		optInUrl: column.optional(),
		consentIp: column.optional(),
	})
	.refine(hasOptInEvidence, {
		message: OPT_IN_EVIDENCE_ISSUE,
		path: ["optInText"],
	});

export type LeadColumnMapping = z.infer<typeof leadColumnMapping>;

export type PartialLeadColumnMapping = Partial<Record<LeadField, string>>;

const ALIASES = {
	phone: [
		"phone",
		"phonenumber",
		"mobile",
		"mobilephone",
		"cell",
		"cellphone",
		"tel",
		"telephone",
	],
	firstName: ["firstname", "first", "fname", "givenname"],
	lastName: ["lastname", "last", "lname", "surname", "familyname"],
	fullName: ["name", "fullname", "contactname"],
	email: ["email", "emailaddress", "mail"],
	consentSource: ["consentsource", "optinsource", "source", "leadsource"],
	consentCapturedAt: [
		"consentcapturedat",
		"consentdate",
		"consenttimestamp",
		"optindate",
		"optinat",
		"optintimestamp",
		"capturedat",
	],
	optInText: ["optintext", "consenttext", "consentlanguage", "disclosure"],
	optInUrl: ["optinurl", "consenturl", "formurl", "sourceurl", "pageurl"],
	consentIp: ["consentip", "ip", "ipaddress", "optinip"],
} satisfies Record<LeadField, readonly string[]>;

export function suggestMapping(headers: string[]): PartialLeadColumnMapping {
	const suggested: PartialLeadColumnMapping = {};
	const used = new Set<string>();

	for (const field of LEAD_FIELDS) {
		const aliases: readonly string[] = ALIASES[field];
		const header = headers.find(
			(candidate) =>
				!used.has(candidate) && aliases.includes(headerKey(candidate)),
		);
		if (header) {
			suggested[field] = header;
			used.add(header);
		}
	}

	return suggested;
}

function missingColumns(
	headers: string[],
	mapping: LeadColumnMapping,
): string[] {
	return LEAD_FIELDS.flatMap((field) => {
		const header = mapping[field];
		return header !== undefined && !headers.includes(header) ? [header] : [];
	});
}

type ResolvedMapping =
	| { ok: true; mapping: LeadColumnMapping }
	| { ok: false; issues: string[] };

export function resolveMapping(
	headers: string[],
	proposed: PartialLeadColumnMapping,
): ResolvedMapping {
	const parsed = leadColumnMapping.safeParse(proposed);
	if (!parsed.success) {
		const issues = parsed.error.issues.map((issue) =>
			issue.path.length > 0 && issue.code === "invalid_type"
				? `Map a column to ${issue.path.join(".")}.`
				: issue.message,
		);
		if (
			!hasOptInEvidence(proposed) &&
			!issues.includes(OPT_IN_EVIDENCE_ISSUE)
		) {
			issues.push(OPT_IN_EVIDENCE_ISSUE);
		}
		return { ok: false, issues };
	}

	const missing = missingColumns(headers, parsed.data);
	if (missing.length > 0) {
		return {
			ok: false,
			issues: missing.map((header) => `The CSV has no column "${header}".`),
		};
	}

	return { ok: true, mapping: parsed.data };
}

export type MappedRow = { rowNumber: number; raw: RawLead };

export function mapRows(
	table: CsvTable,
	mapping: LeadColumnMapping,
): MappedRow[] {
	const indexOf = new Map(
		table.headers.map((header, index) => [header, index]),
	);

	return table.rows.map((row) => {
		const raw: RawLead = {};
		for (const field of LEAD_FIELDS) {
			const header = mapping[field];
			const position = header === undefined ? undefined : indexOf.get(header);
			if (position !== undefined) raw[field] = row.cells[position] ?? null;
		}
		return { rowNumber: row.rowNumber, raw };
	});
}

function headerKey(header: string): string {
	return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}
