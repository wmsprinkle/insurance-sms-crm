"use client";

import Forum from "@carbon/icons-react/es/Forum";
import Search from "@carbon/icons-react/es/Search";
import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import { Card, CardContent } from "@crm/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@crm/ui/components/empty";
import { Icon } from "@crm/ui/components/icon";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@crm/ui/components/input-group";
import { TablePagination } from "@crm/ui/components/table-pagination";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { useSearchInput } from "@crm/ui/hooks/use-search-input";
import { cn } from "@crm/ui/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useQueryStates } from "nuqs";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { SmsThread } from "@/components/crm/sms-thread";
import { LocalRelativeTime } from "@/components/local-date-time";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { smsPreviewPrefix } from "@/lib/sms-presentation";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import {
	INBOX_FILTERS,
	INBOX_PAGE_SIZE,
	type InboxFilter,
	inboxListInput,
	inboxParsers,
} from "./inbox-search-params";

type ThreadRow = RouterOutputs["sms"]["threadList"]["rows"][number];

const FILTER_LABELS = {
	open: "Open",
	all: "All",
} satisfies Record<InboxFilter, string>;

function isFilter(value: string): value is InboxFilter {
	return INBOX_FILTERS.some((filter) => filter === value);
}

export function Inbox() {
	const trpc = useTRPC();
	const [state, setState] = useQueryStates(inboxParsers);
	const selected = state[SEARCH_PARAM.inbox.contact];

	const list = useQuery({
		...trpc.sms.threadList.queryOptions(inboxListInput(state)),
		placeholderData: keepPreviousData,
	});

	const rows = list.data?.rows ?? [];
	const total = list.data?.total ?? 0;
	const counts = list.data?.facetCounts.filter;

	return (
		<div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[22rem_1fr]">
			<div className="flex min-h-0 flex-col gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						spacing={0}
						value={state.show}
						onValueChange={(next) => {
							if (isFilter(next)) void setState({ show: next, page: 1 });
						}}
						aria-label="Which threads to show"
					>
						{INBOX_FILTERS.map((filter) => (
							<ToggleGroupItem key={filter} value={filter}>
								{FILTER_LABELS[filter]}
								{counts ? ` ${counts[filter]}` : ""}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					<InboxSearch
						committed={state.q}
						commit={(q) => void setState({ q, page: 1 })}
					/>
				</div>

				{rows.length === 0 && !list.isPending ? (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Icon icon={Forum} />
							</EmptyMedia>
							<EmptyTitle>
								{state.show === "open" ? "Nothing waiting" : "No texts yet"}
							</EmptyTitle>
							<EmptyDescription>
								{state.show === "open"
									? "Every reply has been handled."
									: "Conversations appear here when a lead is texted or texts back."}
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
						{rows.map((row) => (
							<li key={row.contactId}>
								<ThreadButton
									row={row}
									active={row.contactId === selected}
									onSelect={() =>
										void setState({
											[SEARCH_PARAM.inbox.contact]: row.contactId,
										})
									}
								/>
							</li>
						))}
					</ul>
				)}

				<TablePagination
					page={state.page}
					totalPages={Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE))}
					pageSize={INBOX_PAGE_SIZE}
					total={total}
					loading={list.isFetching}
					onPageChange={(page) => void setState({ page })}
				/>
			</div>

			{selected ? (
				<SelectedThread
					contactId={selected}
					name={rows.find((row) => row.contactId === selected)?.name}
				/>
			) : (
				<Card className="hidden lg:flex">
					<CardContent className="flex flex-1 items-center justify-center">
						<p className="text-muted-foreground text-xs">
							Pick a conversation to read it.
						</p>
					</CardContent>
				</Card>
			)}
		</div>
	);
}

function InboxSearch({
	committed,
	commit,
}: {
	committed: string;
	commit: (value: string) => void;
}) {
	const [value, setValue] = useSearchInput(committed, commit);

	return (
		<InputGroup className="w-full sm:w-48">
			<InputGroupAddon>
				<Search />
			</InputGroupAddon>
			<InputGroupInput
				placeholder="Name or number"
				value={value}
				onChange={(event) => setValue(event.target.value)}
				autoComplete="off"
			/>
		</InputGroup>
	);
}

function ThreadButton({
	row,
	active,
	onSelect,
}: {
	row: ThreadRow;
	active: boolean;
	onSelect: () => void;
}) {
	return (
		<Button
			variant="ghost"
			aria-current={active ? "true" : undefined}
			onClick={onSelect}
			className={cn(
				"h-auto w-full flex-col items-stretch gap-1 py-2 text-left font-normal",
				active && "bg-muted",
			)}
		>
			<span className="flex items-center justify-between gap-2">
				<span className="truncate font-medium">{row.name}</span>
				<span className="shrink-0 text-muted-foreground text-xs">
					<LocalRelativeTime date={row.lastMessage.createdAt} />
				</span>
			</span>
			<span className="flex items-center justify-between gap-2">
				<span className="truncate text-muted-foreground text-xs">
					{smsPreviewPrefix(row.lastMessage.direction)}
					{row.lastMessage.preview}
				</span>
				{row.openCount > 0 ? <Badge>{row.openCount}</Badge> : null}
			</span>
		</Button>
	);
}

function SelectedThread({
	contactId,
	name,
}: {
	contactId: string;
	name: string | undefined;
}) {
	const openRecord = useOpenRecord();

	return (
		<Card className="min-h-0">
			<CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
				<div className="flex items-center justify-between gap-2">
					<h2 className="truncate font-medium">{name ?? "Conversation"}</h2>
					<Button
						variant="outline"
						size="sm"
						onClick={() => openRecord({ kind: "contact", id: contactId })}
					>
						Open contact
					</Button>
				</div>
				<SmsThread contactId={contactId} />
			</CardContent>
		</Card>
	);
}
