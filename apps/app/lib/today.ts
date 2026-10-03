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
		const reply = preview(thread.lastMessage.preview);
		raise(
			thread.contactId,
			thread.name,
			"reply",
			thread.attention
				? `${thread.attention} They wrote: ${reply}`
				: `${thread.openCount === 1 ? "New reply" : `${thread.openCount} new replies`}: ${reply}`,
			thread.lastMessage.createdAt,
			{
				unhandledReplies: thread.openCount,
				lastReply: reply,
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
	telnyxApiKeySet: boolean;
	telnyxNumberSet: boolean;
	telnyxProfileSet: boolean;
	webhookKeySet: boolean;
	fromNumberMasked: string | null;
	modelKeySet: boolean;
	webhookUrl: string;
	dryRun: boolean;
	calendarConnected: boolean;
	leadCount: number;
	brandName: string;
	licensedStates: readonly string[];
};

export type GetStartedAction =
	| { kind: "link"; label: string; href: string }
	| { kind: "copy"; label: string; value: string; copied: string };

export type GetStartedItem = {
	id:
		| "telnyx"
		| "model"
		| "webhook"
		| "mode"
		| "calendar"
		| "leads"
		| "business";
	title: string;
	detail: string;
	status: "done" | "todo" | "info";
	action: GetStartedAction | null;
};

const ENV_VARIABLES = {
	telnyxKey: "TELNYX_API_KEY",
	telnyxProfile: "TELNYX_MESSAGING_PROFILE_ID",
	telnyxNumber: "TELNYX_FROM_NUMBER",
	telnyxPublicKey: "TELNYX_PUBLIC_KEY",
	modelKey: "AI_GATEWAY_API_KEY",
} as const;

function copyVariable(name: string): GetStartedAction {
	return {
		kind: "copy",
		label: `Copy ${name}`,
		value: name,
		copied: `${name} copied. Add it to your .env file and restart.`,
	};
}

function telnyxItem(state: GetStartedState): GetStartedItem {
	const missing: string[] = [];
	if (!state.telnyxApiKeySet) missing.push(ENV_VARIABLES.telnyxKey);
	if (!state.telnyxProfileSet) missing.push(ENV_VARIABLES.telnyxProfile);
	if (!state.telnyxNumberSet) missing.push(ENV_VARIABLES.telnyxNumber);
	const first = missing[0];

	if (first === undefined) {
		return {
			id: "telnyx",
			title: "Telnyx connected",
			detail: `Sending from ${state.fromNumberMasked ?? "your number"}.`,
			status: "done",
			action: null,
		};
	}

	const parts = [
		state.telnyxApiKeySet ? "API key set" : "API key missing",
		state.telnyxNumberSet
			? `number set${state.fromNumberMasked ? ` (${state.fromNumberMasked})` : ""}`
			: "number missing",
	];
	if (!state.telnyxProfileSet) parts.push("messaging profile missing");

	return {
		id: "telnyx",
		title: "Telnyx",
		detail: `${parts.join(", ")}.`,
		status: "todo",
		action: copyVariable(first),
	};
}

export function getStartedItems(state: GetStartedState): GetStartedItem[] {
	const missing = [
		state.brandName.trim() ? null : "business name",
		state.licensedStates.length > 0 ? null : "licensed states",
	].filter((part): part is string => part !== null);

	return [
		telnyxItem(state),
		{
			id: "model",
			title: "Model key set (Anthropic or AI Gateway)",
			detail: state.modelKeySet
				? "The assistant can answer replies."
				: "No key. The assistant cannot answer replies.",
			status: state.modelKeySet ? "done" : "todo",
			action: state.modelKeySet ? null : copyVariable(ENV_VARIABLES.modelKey),
		},
		{
			id: "webhook",
			title: "Webhook URL",
			detail: state.webhookKeySet
				? `Paste into Telnyx: ${state.webhookUrl}`
				: `Paste into Telnyx: ${state.webhookUrl}. ${ENV_VARIABLES.telnyxPublicKey} is missing, so Telnyx replies are refused.`,
			status: state.webhookKeySet ? "done" : "todo",
			action: {
				kind: "copy",
				label: "Copy URL",
				value: state.webhookUrl,
				copied: "Webhook URL copied.",
			},
		},
		{
			id: "mode",
			title: state.dryRun ? "Test mode is on" : "Test mode is off",
			detail: state.dryRun
				? "No texts are really sent. Set DRY_RUN=false to go live."
				: "Texts are real and go to leads' phones.",
			status: "info",
			action: null,
		},
		{
			id: "calendar",
			title: "Google Calendar connected",
			detail: state.calendarConnected
				? "Booked calls land on your calendar."
				: "Connect Google so booked calls land on your calendar.",
			status: state.calendarConnected ? "done" : "todo",
			action: state.calendarConnected
				? null
				: { kind: "link", label: "Connect", href: "/settings/connections" },
		},
		{
			id: "leads",
			title: "First leads imported",
			detail:
				state.leadCount > 0
					? `${state.leadCount} ${state.leadCount === 1 ? "lead" : "leads"} in your list.`
					: "Upload a CSV of leads who agreed to be texted.",
			status: state.leadCount > 0 ? "done" : "todo",
			action:
				state.leadCount > 0
					? null
					: { kind: "link", label: "Import leads", href: "/leads/import" },
		},
		{
			id: "business",
			title: "Business name and licensed states set",
			detail:
				missing.length === 0
					? "Leads see your business name. Only licensed states get texts."
					: `Still to set: ${missing.join(" and ")}.`,
			status: missing.length === 0 ? "done" : "todo",
			action:
				missing.length === 0
					? null
					: {
							kind: "link",
							label: "Open settings",
							href: "/settings/compliance",
						},
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
