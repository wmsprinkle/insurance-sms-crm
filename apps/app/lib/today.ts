import type { RouterOutputs } from "@/lib/trpc/types";

type Summary = RouterOutputs["today"]["summary"];
type Queue = RouterOutputs["smsDrafts"]["queue"];
type OpenThreads = RouterOutputs["sms"]["threadList"];

export const TODAY_VIEW = {
	needsYouShown: 8,
	openThreadsPageSize: 25,
	handoffReasons: {
		ambiguous: "triage:ambiguous",
		abusive: "triage:abusive",
	},
} as const;

const CLOSED_THREADS: ReadonlySet<string> = new Set([
	"not_interested",
	"opted_out",
	"abusive",
]);

export type NeedsYouKind = "unknown_send" | "handoff" | "draft" | "reply";

export type NeedsYouItem = {
	contactId: string;
	name: string;
	kind: NeedsYouKind;
	detail: string;
	at: string;
	draftId: string | null;
	handoff: boolean;
	unhandledReplies: number;
	lastReply: string | null;
};

const KIND_PRIORITY = {
	unknown_send: 0,
	handoff: 1,
	draft: 2,
	reply: 3,
} as const satisfies Record<NeedsYouKind, number>;

export function handoffDetail(reason: string): string {
	if (reason.startsWith(TODAY_VIEW.handoffReasons.ambiguous)) {
		return "The reply is unclear. Read it and answer.";
	}
	if (reason.startsWith(TODAY_VIEW.handoffReasons.abusive)) {
		return "Abusive reply. No more texts go out.";
	}
	return reason;
}

function preview(text: string, limit = 120): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

type Sources = {
	summary: Pick<Summary, "unknownSends">;
	queue: Pick<Queue, "drafts" | "handoffs">;
	threads: Pick<OpenThreads, "rows">;
};

export function needsYouItems({
	summary,
	queue,
	threads,
}: Sources): NeedsYouItem[] {
	const byContact = new Map<string, NeedsYouItem>();

	const raise = (
		contactId: string,
		name: string,
		kind: NeedsYouKind,
		detail: string,
		at: string,
		patch: Partial<NeedsYouItem> = {},
	) => {
		const current = byContact.get(contactId);
		const next: NeedsYouItem = current ?? {
			contactId,
			name,
			kind,
			detail,
			at,
			draftId: null,
			handoff: false,
			unhandledReplies: 0,
			lastReply: null,
		};
		if (current && KIND_PRIORITY[kind] < KIND_PRIORITY[current.kind]) {
			next.kind = kind;
			next.detail = detail;
		}
		if (current && at < current.at) next.at = at;
		byContact.set(contactId, { ...next, ...patch, kind: next.kind });
	};

	for (const send of summary.unknownSends) {
		raise(
			send.contactId,
			send.name,
			"unknown_send",
			"A text may or may not have gone out. Check Telnyx before you send again.",
			send.at,
		);
	}
	for (const handoff of queue.handoffs) {
		if (handoff.reason.startsWith(TODAY_VIEW.handoffReasons.abusive)) continue;
		raise(
			handoff.contactId,
			handoff.name,
			"handoff",
			handoffDetail(handoff.reason),
			handoff.createdAt,
			{ handoff: true },
		);
	}
	for (const draft of queue.drafts) {
		raise(
			draft.contactId,
			draft.name,
			"draft",
			`Reply waiting for your OK: ${preview(draft.body)}`,
			draft.createdAt,
			{ draftId: draft.id },
		);
	}
	for (const thread of threads.rows) {
		if (thread.openCount === 0 || CLOSED_THREADS.has(thread.funnelStatus)) {
			continue;
		}
		raise(
			thread.contactId,
			thread.name,
			"reply",
			`${thread.openCount === 1 ? "New reply" : `${thread.openCount} new replies`}: ${preview(thread.lastMessage.preview)}`,
			thread.lastMessage.createdAt,
			{
				unhandledReplies: thread.openCount,
				lastReply: preview(thread.lastMessage.preview),
			},
		);
	}

	return [...byContact.values()].sort(
		(a, b) =>
			KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || a.at.localeCompare(b.at),
	);
}

export const KPI_DEFINITIONS = [
	{
		id: "imported",
		label: "Leads imported",
		help: "New leads added in the last 7 days.",
	},
	{
		id: "texted",
		label: "Texted",
		help: "Leads who got a text in the last 7 days.",
	},
	{
		id: "replied",
		label: "Replied",
		help: "Leads who texted back in the last 7 days.",
	},
	{
		id: "interested",
		label: "Interested",
		help: "Leads who became interested in the last 7 days.",
	},
	{
		id: "booked",
		label: "Booked",
		help: "Meetings booked in the last 7 days.",
	},
] as const satisfies readonly {
	id: keyof Summary["kpis"];
	label: string;
	help: string;
}[];

export type GetStartedState = {
	telnyxConfigured: boolean;
	fromNumber: string | null;
	dryRun: boolean;
	calendarConnected: boolean;
	leadCount: number;
	brandName: string;
	licensedStates: readonly string[];
};

export type GetStartedItem = {
	id: "number" | "mode" | "calendar" | "leads" | "business";
	title: string;
	detail: string;
	status: "done" | "todo" | "info";
	href: string | null;
	actionLabel: string | null;
};

export function getStartedItems(state: GetStartedState): GetStartedItem[] {
	const missing = [
		state.brandName.trim() ? null : "business name",
		state.licensedStates.length > 0 ? null : "licensed states",
	].filter((part): part is string => part !== null);

	return [
		{
			id: "number",
			title: "Telnyx number connected",
			detail: state.telnyxConfigured
				? `Texts go out from ${state.fromNumber ?? "your number"}.`
				: "Set TELNYX_API_KEY, TELNYX_MESSAGING_PROFILE_ID and TELNYX_FROM_NUMBER in your .env file, then restart the app.",
			status: state.telnyxConfigured ? "done" : "todo",
			href: null,
			actionLabel: null,
		},
		{
			id: "mode",
			title: state.dryRun ? "Test mode is on" : "Test mode is off",
			detail: state.dryRun
				? "No texts are really sent. Set DRY_RUN=false when you are ready to go live."
				: "Texts are real and go to leads' phones.",
			status: "info",
			href: null,
			actionLabel: null,
		},
		{
			id: "calendar",
			title: "Google Calendar connected",
			detail: state.calendarConnected
				? "Booked calls land on your calendar."
				: "Connect Google so booked calls land on your calendar.",
			status: state.calendarConnected ? "done" : "todo",
			href: "/settings/connections",
			actionLabel: state.calendarConnected ? null : "Connect",
		},
		{
			id: "leads",
			title: "First leads imported",
			detail:
				state.leadCount > 0
					? `${state.leadCount} ${state.leadCount === 1 ? "lead" : "leads"} in your list.`
					: "Upload a CSV of leads who agreed to be texted.",
			status: state.leadCount > 0 ? "done" : "todo",
			href: "/leads/import",
			actionLabel: state.leadCount > 0 ? null : "Import leads",
		},
		{
			id: "business",
			title: "Business name and licensed states set",
			detail:
				missing.length === 0
					? "Leads see your business name. Only licensed states get texts."
					: `Still to set: ${missing.join(" and ")}.`,
			status: missing.length === 0 ? "done" : "todo",
			href: "/settings/compliance",
			actionLabel: missing.length === 0 ? null : "Open settings",
		},
	];
}

export type GetStartedProgress = { done: number; total: number };

export function getStartedProgress(
	items: readonly GetStartedItem[],
): GetStartedProgress {
	const countable = items.filter((item) => item.status !== "info");
	return {
		done: countable.filter((item) => item.status === "done").length,
		total: countable.length,
	};
}
