import type {
	LeadCandidate,
	LeadCheck,
	LeadRejection,
	RawLead,
} from "./lead-validation";
import { checkLead } from "./lead-validation";

export const LEAD_ROW_STATUSES = [
	"ready",
	"created",
	"duplicate",
	"rejected",
] as const;

type LeadRowStatus = (typeof LEAD_ROW_STATUSES)[number];

export type LeadRowResult = {
	rowNumber: number;
	phone: string | null;
	status: LeadRowStatus;
	reasons: LeadRejection[];
	contactId: string | null;
};

export type ExistingContacts = {
	byPhone: Map<string, string>;
	byEmail: Map<string, string>;
};

export type ReadyLead = { rowNumber: number; lead: LeadCandidate };

export type LeadTriage = {
	results: LeadRowResult[];
	ready: ReadyLead[];
};

export type CheckedRow = { rowNumber: number; check: LeadCheck };

export function checkRows(
	rows: { rowNumber: number; raw: RawLead }[],
	now: Date = new Date(),
): CheckedRow[] {
	return rows.map((row) => ({
		rowNumber: row.rowNumber,
		check: checkLead(row.raw, now),
	}));
}

export function candidatePhones(rows: CheckedRow[]): string[] {
	return rows.flatMap((row) => (row.check.ok ? [row.check.lead.phone] : []));
}

export function candidateEmails(rows: CheckedRow[]): string[] {
	return rows.flatMap((row) =>
		row.check.ok && row.check.lead.email ? [row.check.lead.email] : [],
	);
}

export function triage(
	rows: CheckedRow[],
	existing: ExistingContacts,
): LeadTriage {
	const seenPhones = new Set<string>();
	const seenEmails = new Set<string>();
	const results: LeadRowResult[] = [];
	const ready: ReadyLead[] = [];

	for (const { rowNumber, check } of rows) {
		if (!check.ok) {
			results.push({
				rowNumber,
				phone: null,
				status: "rejected",
				reasons: check.reasons,
				contactId: null,
			});
			continue;
		}

		const { lead } = check;
		const phoneOwner = existing.byPhone.get(lead.phone);
		const emailOwner = lead.email
			? existing.byEmail.get(lead.email)
			: undefined;

		if (phoneOwner || emailOwner) {
			results.push({
				rowNumber,
				phone: lead.phone,
				status: "duplicate",
				reasons: [phoneOwner ? "duplicate_phone" : "duplicate_email"],
				contactId: phoneOwner ?? emailOwner ?? null,
			});
			continue;
		}

		if (
			seenPhones.has(lead.phone) ||
			(lead.email !== null && seenEmails.has(lead.email))
		) {
			results.push({
				rowNumber,
				phone: lead.phone,
				status: "duplicate",
				reasons: ["duplicate_in_batch"],
				contactId: null,
			});
			continue;
		}

		seenPhones.add(lead.phone);
		if (lead.email) seenEmails.add(lead.email);
		results.push({
			rowNumber,
			phone: lead.phone,
			status: "ready",
			reasons: [],
			contactId: null,
		});
		ready.push({ rowNumber, lead });
	}

	return { results, ready };
}

export type LeadTotals = Record<LeadRowStatus, number> & { rows: number };

export function totalsOf(results: LeadRowResult[]): LeadTotals {
	const totals: LeadTotals = {
		rows: results.length,
		ready: 0,
		created: 0,
		duplicate: 0,
		rejected: 0,
	};
	for (const result of results) totals[result.status] += 1;
	return totals;
}
