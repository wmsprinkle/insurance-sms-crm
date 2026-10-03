import type { StatusTone } from "@crm/ui/components/status-indicator";
import type { RouterOutputs } from "@/lib/trpc/types";

export type LeadStatus =
	RouterOutputs["today"]["leads"]["rows"][number]["status"];

type LeadStatusMeta = {
	label: string;
	tone: StatusTone;
	help: string;
};

const META = {
	new: {
		label: "New",
		tone: "neutral",
		help: "Imported. No text has gone out yet.",
	},
	texted: {
		label: "Texted",
		tone: "info",
		help: "The first message went out. No reply yet.",
	},
	replied: {
		label: "Replied",
		tone: "primary",
		help: "The lead answered. The reply is not sorted yet.",
	},
	interested: {
		label: "Interested",
		tone: "success",
		help: "The lead wants to talk.",
	},
	not_interested: {
		label: "Not interested",
		tone: "neutral",
		help: "The lead said no. Nothing more is sent.",
	},
	needs_you: {
		label: "Needs you",
		tone: "warning",
		help: "A person must act: a hand-off, a draft or an unknown send.",
	},
	booked: {
		label: "Booked",
		tone: "success",
		help: "A meeting is on the calendar.",
	},
	opted_out: {
		label: "Opted out",
		tone: "error",
		help: "The lead asked for no more texts. Nothing is sent.",
	},
} as const satisfies Record<LeadStatus, LeadStatusMeta>;

export const LEAD_STATUS_ORDER = [
	"needs_you",
	"new",
	"texted",
	"replied",
	"interested",
	"booked",
	"not_interested",
	"opted_out",
] as const satisfies readonly LeadStatus[];

export function leadStatusMeta(status: LeadStatus): LeadStatusMeta {
	return META[status];
}
