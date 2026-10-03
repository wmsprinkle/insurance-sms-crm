"use client";

import ArrowRight from "@carbon/icons-react/es/ArrowRight";
import Calendar from "@carbon/icons-react/es/Calendar";
import CheckmarkFilled from "@carbon/icons-react/es/CheckmarkFilled";
import CheckmarkOutline from "@carbon/icons-react/es/CheckmarkOutline";
import CircleDash from "@carbon/icons-react/es/CircleDash";
import Information from "@carbon/icons-react/es/Information";
import Video from "@carbon/icons-react/es/Video";
import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { StatGroup } from "@crm/ui/components/dashboard";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@crm/ui/components/empty";
import { Icon } from "@crm/ui/components/icon";
import { Spinner } from "@crm/ui/components/spinner";
import { StatCard } from "@crm/ui/components/stat-card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AutoSendSwitch } from "@/components/crm/auto-send-switch";
import { BulkDraftActions } from "@/components/crm/bulk-drafts";
import { LocalDateTime, LocalRelativeTime } from "@/components/local-date-time";
import { firstMessageDrafts, smsOutcomeNotice } from "@/lib/sms-drafts";
import {
	type GetStartedAction,
	getStartedItems,
	getStartedProgress,
	KPI_DEFINITIONS,
	type NeedsYouItem,
	type NeedsYouKind,
	needsYouItems,
	TODAY_VIEW,
} from "@/lib/today";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

type Summary = RouterOutputs["today"]["summary"];
type Meeting = Summary["meetings"][number];

const MEETING_TIME = {
	weekday: "short",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions;

const KIND_LABEL = {
	unknown_send: "Check send",
	handoff: "Hand-off",
	draft: "Draft",
	reply: "Reply",
} as const satisfies Record<NeedsYouKind, string>;

function useRefreshToday() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.today.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.smsDrafts.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.sms.pathKey() }),
		]);
}

export function TodayView() {
	const trpc = useTRPC();
	const summary = useQuery(trpc.today.summary.queryOptions());
	const queue = useQuery(trpc.smsDrafts.queue.queryOptions());
	const threads = useQuery(
		trpc.sms.threadList.queryOptions({
			q: "",
			sort: "",
			dir: "asc",
			page: 1,
			pageSize: TODAY_VIEW.openThreadsPageSize,
			filter: "open",
		}),
	);
	const sms = useQuery(trpc.settings.sms.queryOptions());
	const calendar = useQuery(trpc.settings.calendar.queryOptions());

	const failure = summary.error ?? queue.error ?? threads.error;
	if (failure) {
		return (
			<Alert variant="destructive">
				<AlertTitle>Could not load Today</AlertTitle>
				<AlertDescription className="flex flex-col items-start gap-3">
					<span>{failure.message}</span>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							void summary.refetch();
							void queue.refetch();
							void threads.refetch();
						}}
					>
						Try again
					</Button>
				</AlertDescription>
			</Alert>
		);
	}

	if (!summary.data || !queue.data || !threads.data) {
		return (
			<div aria-busy="true" className="flex justify-center py-12">
				<Spinner size="lg" />
			</div>
		);
	}

	const items = needsYouItems({
		summary: summary.data,
		queue: queue.data,
		threads: threads.data,
	});
	const started = getStartedItems({
		telnyxApiKeySet: summary.data.setup.telnyxApiKeySet,
		telnyxNumberSet: summary.data.setup.telnyxNumberSet,
		telnyxProfileSet: summary.data.setup.telnyxProfileSet,
		webhookKeySet: summary.data.setup.webhookKeySet,
		fromNumberMasked: summary.data.setup.fromNumberMasked,
		modelKeySet: summary.data.setup.modelKeySet,
		webhookUrl: summary.data.setup.webhookUrl,
		dryRun: summary.data.dryRun,
		calendarConnected: (calendar.data?.accounts.length ?? 0) > 0,
		leadCount: summary.data.setup.leadCount,
		brandName: sms.data?.settings.brandName ?? "",
		licensedStates: sms.data?.settings.licensedStates ?? [],
	});
	const progress = getStartedProgress(started);

	return (
		<div className="flex flex-col gap-6">
			<KpiStrip summary={summary.data} />

			<div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<div className="flex min-w-0 flex-col gap-6">
					<AutoSendSwitch />
					<NeedsYouCard
						items={items}
						firstDrafts={firstMessageDrafts(queue.data.drafts)}
					/>
					<MeetingsCard meetings={summary.data.meetings} />
				</div>
				<GetStartedCard
					items={started}
					progress={progress}
					loading={sms.isPending || calendar.isPending}
				/>
			</div>
		</div>
	);
}

function KpiStrip({ summary }: { summary: Summary }) {
	return (
		<section aria-label={`This week, last ${summary.windowDays} days`}>
			<StatGroup columns={5}>
				{KPI_DEFINITIONS.map((kpi) => (
					<StatCard
						key={kpi.id}
						label={kpi.label}
						value={summary.kpis[kpi.id]}
						description={kpi.help}
					/>
				))}
			</StatGroup>
		</section>
	);
}

function NeedsYouCard({
	items,
	firstDrafts,
}: {
	items: NeedsYouItem[];
	firstDrafts: ReturnType<typeof firstMessageDrafts>;
}) {
	const [expanded, setExpanded] = useState(false);
	const shown = expanded ? items : items.slice(0, TODAY_VIEW.needsYouShown);
	const workspaceUrl = useWorkspaceUrl();

	return (
		<section aria-labelledby="needs-you-title" className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<h2 id="needs-you-title" className="font-medium text-lg">
					Needs you
				</h2>
				{items.length > 0 ? (
					<Badge variant="secondary">{items.length}</Badge>
				) : null}
			</div>

			<BulkDraftActions drafts={firstDrafts} />

			{items.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Icon icon={CheckmarkOutline} />
						</EmptyMedia>
						<EmptyTitle>You are all caught up</EmptyTitle>
						<EmptyDescription>
							Hand-offs, unclear replies, drafts and sends to check show up
							here.
						</EmptyDescription>
					</EmptyHeader>
					<Button asChild variant="outline">
						<Link href={workspaceUrl("/leads")}>See all leads</Link>
					</Button>
				</Empty>
			) : (
				<ul className="flex flex-col gap-2">
					{shown.map((item) => (
						<NeedsYouRow key={item.contactId} item={item} />
					))}
				</ul>
			)}

			{items.length > TODAY_VIEW.needsYouShown ? (
				<Button
					variant="ghost"
					size="sm"
					className="self-start"
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded ? "Show fewer" : `Show all ${items.length}`}
				</Button>
			) : null}
		</section>
	);
}

function NeedsYouRow({ item }: { item: NeedsYouItem }) {
	const trpc = useTRPC();
	const refresh = useRefreshToday();
	const workspaceUrl = useWorkspaceUrl();

	const approve = useMutation(
		trpc.smsDrafts.approve.mutationOptions({
			onSuccess: async (outcome) => {
				const notice = smsOutcomeNotice(outcome);
				if (notice.sent) toast.success(notice.title);
				else toast.error(`${notice.title}. ${notice.description}`);
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const discard = useMutation(
		trpc.smsDrafts.discard.mutationOptions({
			onSuccess: async () => {
				toast.success("Draft discarded.");
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const handBack = useMutation(
		trpc.smsDrafts.handBack.mutationOptions({
			onSuccess: async (result) => {
				toast.success(
					result.queued
						? "Handed back. The assistant will answer."
						: "Handed back.",
				);
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const markHandled = useMutation(
		trpc.sms.markHandled.mutationOptions({
			onSuccess: async () => {
				toast.success("Marked handled.");
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const busy =
		approve.isPending ||
		discard.isPending ||
		handBack.isPending ||
		markHandled.isPending;
	const leadHref = workspaceUrl(`/leads/${item.contactId}`);

	return (
		<li className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<Link
						href={leadHref}
						className="truncate font-medium underline-offset-4 hover:underline"
					>
						{item.name || "Unnamed lead"}
					</Link>
					<Badge variant="outline">{KIND_LABEL[item.kind]}</Badge>
					<span className="text-muted-foreground text-xs">
						<LocalRelativeTime date={item.at} />
					</span>
				</div>
				<p className="line-clamp-2 text-muted-foreground text-sm">
					{item.detail}
				</p>
				{item.lastReply && item.kind !== "reply" ? (
					<p className="line-clamp-2 border-l-2 pl-2 text-sm">
						<span className="sr-only">Their reply: </span>
						{item.lastReply}
					</p>
				) : null}
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-2">
				{item.draftId ? (
					<>
						<Button
							size="sm"
							disabled={busy}
							onClick={() =>
								item.draftId && approve.mutate({ draftId: item.draftId })
							}
						>
							{approve.isPending ? <Spinner data-icon="inline-start" /> : null}
							Send draft
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={() =>
								item.draftId && discard.mutate({ draftId: item.draftId })
							}
						>
							Discard
						</Button>
					</>
				) : null}
				{item.handoff ? (
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() => handBack.mutate({ contactId: item.contactId })}
					>
						Hand back
					</Button>
				) : null}
				{!item.draftId && item.unhandledReplies > 0 ? (
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() => markHandled.mutate({ contactId: item.contactId })}
					>
						Mark handled
					</Button>
				) : null}
				<Button asChild size="sm" variant="ghost">
					<Link href={leadHref}>
						Open
						<Icon icon={ArrowRight} data-icon="inline-end" />
					</Link>
				</Button>
			</div>
		</li>
	);
}

function MeetingsCard({ meetings }: { meetings: Meeting[] }) {
	const workspaceUrl = useWorkspaceUrl();

	return (
		<section aria-labelledby="meetings-title" className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<h2 id="meetings-title" className="font-medium text-lg">
					Upcoming meetings
				</h2>
				<Button asChild variant="ghost" size="sm">
					<Link href={workspaceUrl("/meetings")}>All meetings</Link>
				</Button>
			</div>

			{meetings.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Icon icon={Calendar} />
						</EmptyMedia>
						<EmptyTitle>No meetings booked yet</EmptyTitle>
						<EmptyDescription>
							When a lead picks a time, the call shows up here and on your
							calendar.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ul className="flex flex-col gap-2">
					{meetings.map((meeting) => (
						<li
							key={meeting.id}
							className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3"
						>
							<div className="flex min-w-0 flex-col gap-0.5">
								<Link
									href={workspaceUrl(`/leads/${meeting.contactId}`)}
									className="truncate font-medium underline-offset-4 hover:underline"
								>
									{meeting.name || "Unnamed lead"}
								</Link>
								<span className="text-muted-foreground text-sm">
									<LocalDateTime
										date={meeting.startsAt}
										options={MEETING_TIME}
									/>
								</span>
							</div>
							{meeting.conferenceUrl ? (
								<Button asChild size="sm" variant="outline">
									<a
										href={meeting.conferenceUrl}
										target="_blank"
										rel="noreferrer"
									>
										<Icon icon={Video} data-icon="inline-start" />
										Join
									</a>
								</Button>
							) : null}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function GetStartedButton({ action }: { action: GetStartedAction }) {
	const workspaceUrl = useWorkspaceUrl();

	if (action.kind === "link") {
		return (
			<Button asChild size="sm" variant="outline" className="self-start">
				<Link href={workspaceUrl(action.href)}>{action.label}</Link>
			</Button>
		);
	}

	return (
		<Button
			size="sm"
			variant="outline"
			className="self-start"
			onClick={() => {
				navigator.clipboard.writeText(action.value).then(
					() => toast.success(action.copied),
					() => toast.error("Could not copy. Select the text and copy it."),
				);
			}}
		>
			{action.label}
		</Button>
	);
}

function GetStartedCard({
	items,
	progress,
	loading,
}: {
	items: ReturnType<typeof getStartedItems>;
	progress: ReturnType<typeof getStartedProgress>;
	loading: boolean;
}) {
	const complete = progress.done === progress.total;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Get started</CardTitle>
				<CardDescription>
					{loading
						? "Checking your setup…"
						: complete
							? "Everything is set up."
							: `${progress.done} of ${progress.total} done`}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ul className="flex flex-col gap-4">
					{items.map((item) => (
						<li key={item.id} className="flex gap-3">
							<Icon
								icon={
									item.status === "done"
										? CheckmarkFilled
										: item.status === "info"
											? Information
											: CircleDash
								}
								className={
									item.status === "done"
										? "mt-0.5 text-success"
										: "mt-0.5 text-muted-foreground"
								}
								aria-hidden
							/>
							<div className="flex min-w-0 flex-col gap-1">
								<span className="font-medium text-sm">
									{item.title}
									<span className="sr-only">
										{item.status === "done"
											? " (done)"
											: item.status === "todo"
												? " (to do)"
												: ""}
									</span>
								</span>
								<span className="text-muted-foreground text-xs/relaxed">
									{item.detail}
								</span>
								{item.action ? <GetStartedButton action={item.action} /> : null}
							</div>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
