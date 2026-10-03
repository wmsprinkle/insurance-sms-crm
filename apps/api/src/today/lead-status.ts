import {
	FUNNEL_STATUSES,
	type FunnelStatus,
} from "@crm/validation/funnel-status";

export const LEAD_STATUSES = FUNNEL_STATUSES;

export type LeadStatus = FunnelStatus;

export type LeadOverlay = {
	booked: boolean;
	pendingDraft: boolean;
	unknownSend: boolean;
};

const FINAL: ReadonlySet<LeadStatus> = new Set([
	"opted_out",
	"abusive",
	"not_interested",
	"booked",
]);

export function leadStatusOf(
	funnel: LeadStatus,
	overlay: LeadOverlay,
): LeadStatus {
	if (funnel === "opted_out" || funnel === "abusive") return funnel;
	if (overlay.booked) return "booked";
	if (FINAL.has(funnel)) return funnel;
	if (overlay.pendingDraft || overlay.unknownSend) return "needs_you";
	return funnel;
}

export function statusCounts(
	statuses: readonly LeadStatus[],
): Record<LeadStatus, number> {
	const counts = Object.fromEntries(
		LEAD_STATUSES.map((status) => [status, 0]),
	) as Record<LeadStatus, number>;
	for (const status of statuses) counts[status] += 1;
	return counts;
}
