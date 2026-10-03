import { LEAD_STATUS_ORDER, type LeadStatus } from "@/lib/lead-status";
import type { RouterOutputs } from "@/lib/trpc/types";

export type LeadRow = RouterOutputs["today"]["leads"]["rows"][number];

export const LEADS = {
	pageSize: 25,
	allLabel: "All",
	youPrefix: "You: ",
	noMessage: "No texts yet",
	quickReplies: [
		"Yes, tell me more",
		"Not interested",
		"STOP",
		"What does it cost?",
		"Call me tomorrow at 3",
	],
} as const;

export type StatusChip = {
	value: LeadStatus | null;
	label: string;
	count: number;
	active: boolean;
};

export function leadsListInput(values: {
	q: string;
	page: number;
	status: readonly LeadStatus[];
}) {
	return {
		q: values.q,
		page: values.page,
		pageSize: LEADS.pageSize,
		status: [...values.status],
		dir: "desc" as const,
		sort: "",
	};
}

export function toggleStatus(
	current: readonly LeadStatus[],
	status: LeadStatus,
): LeadStatus[] {
	return current.includes(status)
		? current.filter((item) => item !== status)
		: [...current, status];
}

export function statusChips(
	counts: Readonly<Partial<Record<LeadStatus, number>>>,
	selected: readonly LeadStatus[],
	labelOf: (status: LeadStatus) => string,
): StatusChip[] {
	const total = LEAD_STATUS_ORDER.reduce(
		(sum, status) => sum + (counts[status] ?? 0),
		0,
	);
	return [
		{
			value: null,
			label: LEADS.allLabel,
			count: total,
			active: selected.length === 0,
		},
		...LEAD_STATUS_ORDER.map((status) => ({
			value: status,
			label: labelOf(status),
			count: counts[status] ?? 0,
			active: selected.includes(status),
		})),
	];
}

export function toggleId(selected: readonly string[], id: string): string[] {
	return selected.includes(id)
		? selected.filter((item) => item !== id)
		: [...selected, id];
}

export function allSelected(
	selected: readonly string[],
	pageIds: readonly string[],
): boolean {
	return pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
}

export function togglePage(
	selected: readonly string[],
	pageIds: readonly string[],
): string[] {
	if (allSelected(selected, pageIds)) {
		return selected.filter((id) => !pageIds.includes(id));
	}
	return [...new Set([...selected, ...pageIds])];
}

export function previewOf(row: Pick<LeadRow, "lastMessage">): string {
	if (!row.lastMessage) return LEADS.noMessage;
	const prefix =
		row.lastMessage.direction === "OUTBOUND" ? LEADS.youPrefix : "";
	return `${prefix}${row.lastMessage.preview}`;
}

export function isFiltered(values: {
	q: string;
	status: readonly LeadStatus[];
}): boolean {
	return values.q.trim() !== "" || values.status.length > 0;
}

export const ALL_CHIP = "all";

function isStatus(value: string): value is LeadStatus {
	return LEAD_STATUS_ORDER.some((status) => status === value);
}

export function nextStatuses(
	previous: readonly LeadStatus[],
	chosen: readonly string[],
): LeadStatus[] {
	const addedAll = previous.length > 0 && chosen.includes(ALL_CHIP);
	return addedAll ? [] : chosen.filter(isStatus);
}

export const CONSENT_SOURCE_LABELS = {
	WEB_FORM: "Web form",
	LEAD_IMPORT: "Lead import",
	API: "Lead webhook",
	SMS_KEYWORD: "Text keyword",
	MANUAL: "Entered by hand",
} as const satisfies Record<
	NonNullable<RouterOutputs["today"]["lead"]["consent"]>["source"],
	string
>;

export const SUPPRESSION_LABELS = {
	STOP_KEYWORD: "The lead replied STOP.",
	OPT_OUT_REQUEST: "The lead asked not to be texted.",
	WRONG_NUMBER: "The lead said it is the wrong number.",
	CARRIER_BLOCK: "The carrier blocked this number.",
	MANUAL: "A person blocked this number.",
} as const satisfies Record<
	NonNullable<RouterOutputs["today"]["lead"]["suppression"]>["reason"],
	string
>;

export const TIMELINE_DOT = {
	imported: "neutral",
	consent: "success",
	sent: "info",
	replied: "primary",
	handoff: "warning",
	draft: "warning",
	booked: "success",
	opted_out: "error",
} as const satisfies Record<
	RouterOutputs["today"]["lead"]["timeline"][number]["kind"],
	"neutral" | "primary" | "info" | "success" | "warning" | "error"
>;
