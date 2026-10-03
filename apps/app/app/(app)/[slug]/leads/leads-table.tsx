"use client";

import Search from "@carbon/icons-react/es/Search";
import UserMultiple from "@carbon/icons-react/es/UserMultiple";
import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@crm/ui/components/alert-dialog";
import { Button } from "@crm/ui/components/button";
import { Card } from "@crm/ui/components/card";
import { Checkbox } from "@crm/ui/components/checkbox";
import {
	Empty,
	EmptyContent,
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
import { Skeleton } from "@crm/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@crm/ui/components/table";
import { TablePagination } from "@crm/ui/components/table-pagination";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { useSearchInput } from "@crm/ui/hooks/use-search-input";
import { formatCount } from "@crm/ui/lib/format";
import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryStates } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";
import { reportBulk } from "@/components/crm/bulk-actions";
import { LeadStatusPill } from "@/components/crm/lead-status-pill";
import { LocalDateTime, LocalRelativeTime } from "@/components/local-date-time";
import { leadStatusMeta } from "@/lib/lead-status";
import {
	ALL_CHIP,
	allSelected,
	isFiltered,
	LEADS,
	type LeadRow,
	leadsListInput,
	nextStatuses,
	previewOf,
	statusChips,
	toggleId,
	togglePage,
} from "@/lib/leads";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import { leadsParsers } from "./leads-search-params";

const ADDED_OPTIONS = {
	month: "short",
	day: "numeric",
	year: "numeric",
} as const satisfies Intl.DateTimeFormatOptions;

const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f", "g", "h"];

export function LeadsTableSkeleton() {
	return (
		<div aria-busy="true" className="flex flex-col gap-3">
			<Skeleton className="h-8 w-full max-w-md" />
			{SKELETON_ROWS.map((id) => (
				<Skeleton key={id} className="h-12 w-full" />
			))}
			<span role="status" className="sr-only">
				Loading leads…
			</span>
		</div>
	);
}

export function LeadsTable() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const queryClient = useQueryClient();
	const workspaceUrl = useWorkspaceUrl();
	const router = useRouter();
	const [state, setState] = useQueryStates(leadsParsers);
	const [selected, setSelected] = useState<string[]>([]);
	const [confirming, setConfirming] = useState(false);

	const list = useQuery({
		...trpc.today.leads.queryOptions(leadsListInput(state)),
		placeholderData: keepPreviousData,
	});

	const archive = useMutation(
		trpc.contacts.bulkArchive.mutationOptions({
			onSuccess: async (result, variables) => {
				await Promise.all([
					cache.removedMany({ kind: "contact", ids: variables.ids }),
					queryClient.invalidateQueries({ queryKey: trpc.today.pathKey() }),
				]);
				reportBulk(
					result,
					(count) => `${formatCount(count, "lead")} removed from the list.`,
				);
				setSelected([]);
				setConfirming(false);
			},
			onError: (error) => {
				setConfirming(false);
				toast.error(error.message);
			},
		}),
	);

	if (list.error && !list.data) {
		return (
			<Alert variant="destructive">
				<AlertTitle>Could not load your leads</AlertTitle>
				<AlertDescription>
					<p>{list.error.message}</p>
					<Button variant="outline" size="sm" onClick={() => list.refetch()}>
						Try again
					</Button>
				</AlertDescription>
			</Alert>
		);
	}

	if (!list.data) return <LeadsTableSkeleton />;

	const { rows, total, statusCounts, truncated } = list.data;
	const pageIds = rows.map((row) => row.contactId);
	const filtered = isFiltered(state);
	const everything = Object.values(statusCounts).reduce(
		(sum, count) => sum + count,
		0,
	);
	const chips = statusChips(
		statusCounts,
		state.status,
		(status) => leadStatusMeta(status).label,
	);

	const open = (row: LeadRow) =>
		router.push(workspaceUrl(`/leads/${row.contactId}`));

	if (everything === 0 && !filtered) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Icon icon={UserMultiple} />
					</EmptyMedia>
					<EmptyTitle>No leads yet</EmptyTitle>
					<EmptyDescription>
						Import a CSV of people who agreed to get texts. Each new lead gets
						one first message.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button asChild>
						<Link href={workspaceUrl("/leads/import")}>Import leads</Link>
					</Button>
				</EmptyContent>
			</Empty>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<LeadsSearch
					committed={state.q}
					commit={(q) => {
						setSelected([]);
						void setState({ q, page: 1 });
					}}
				/>
				<ToggleGroup
					type="multiple"
					variant="outline"
					size="sm"
					spacing={0}
					className="flex-wrap"
					value={state.status.length > 0 ? state.status : [ALL_CHIP]}
					onValueChange={(chosen) => {
						setSelected([]);
						void setState({
							status: nextStatuses(state.status, chosen),
							page: 1,
						});
					}}
					aria-label="Filter by status"
				>
					{chips.map((chip) => (
						<ToggleGroupItem
							key={chip.value ?? ALL_CHIP}
							value={chip.value ?? ALL_CHIP}
						>
							{chip.label} {chip.count}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>

			{selected.length > 0 ? (
				<section
					aria-label="Bulk actions"
					className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
				>
					<span className="text-sm">
						{formatCount(selected.length, "lead")} selected
					</span>
					<div className="flex gap-2">
						<Button variant="outline" size="sm" onClick={() => setSelected([])}>
							Clear
						</Button>
						<Button
							variant="destructive"
							size="sm"
							disabled={archive.isPending}
							onClick={() => setConfirming(true)}
						>
							Remove
						</Button>
					</div>
				</section>
			) : null}

			{truncated ? (
				<Alert>
					<AlertTitle>Showing the newest leads only</AlertTitle>
					<AlertDescription>Search to find an older lead.</AlertDescription>
				</Alert>
			) : null}

			{rows.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Icon icon={Search} />
						</EmptyMedia>
						<EmptyTitle>No leads match</EmptyTitle>
						<EmptyDescription>
							Try another name or number, or clear the status filter.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button
							variant="outline"
							onClick={() => void setState({ q: "", status: [], page: 1 })}
						>
							Clear filters
						</Button>
					</EmptyContent>
				</Empty>
			) : (
				<Card className="overflow-hidden p-0">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-10">
									<Checkbox
										aria-label="Select all leads on this page"
										checked={allSelected(selected, pageIds)}
										onCheckedChange={() =>
											setSelected(togglePage(selected, pageIds))
										}
									/>
								</TableHead>
								<TableHead>Lead</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="hidden md:table-cell">
									Last message
								</TableHead>
								<TableHead className="hidden lg:table-cell">Added</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<TableRow
									key={row.contactId}
									tabIndex={0}
									aria-label={`Open ${row.name}`}
									data-state={
										selected.includes(row.contactId) ? "selected" : undefined
									}
									className="cursor-pointer focus-visible:bg-muted focus-visible:outline-none"
									onClick={() => open(row)}
									onKeyDown={(event) => {
										if (event.target !== event.currentTarget) return;
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											open(row);
										}
									}}
								>
									<TableCell onClick={(event) => event.stopPropagation()}>
										<Checkbox
											aria-label={`Select ${row.name}`}
											checked={selected.includes(row.contactId)}
											onCheckedChange={() =>
												setSelected(toggleId(selected, row.contactId))
											}
										/>
									</TableCell>
									<TableCell>
										<div className="flex flex-col">
											<span className="font-medium">{row.name}</span>
											<span className="text-muted-foreground text-xs">
												{row.phone ?? "No phone"}
											</span>
											<span className="line-clamp-1 text-muted-foreground text-xs md:hidden">
												{previewOf(row)}
											</span>
										</div>
									</TableCell>
									<TableCell>
										<div className="flex flex-col items-start gap-1">
											<LeadStatusPill status={row.status} />
											{row.attention ? (
												<span className="line-clamp-2 max-w-48 text-muted-foreground text-xs">
													{row.attention}
												</span>
											) : null}
										</div>
									</TableCell>
									<TableCell className="hidden max-w-xs md:table-cell">
										<div className="flex flex-col">
											<span className="truncate text-muted-foreground text-xs">
												{previewOf(row)}
											</span>
											{row.lastMessage ? (
												<span className="text-muted-foreground text-xs">
													<LocalRelativeTime date={row.lastMessage.at} />
												</span>
											) : null}
										</div>
									</TableCell>
									<TableCell className="hidden text-muted-foreground text-xs lg:table-cell">
										<LocalDateTime
											date={row.createdAt}
											options={ADDED_OPTIONS}
										/>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</Card>
			)}

			<TablePagination
				page={state.page}
				totalPages={Math.max(1, Math.ceil(total / LEADS.pageSize))}
				pageSize={LEADS.pageSize}
				total={total}
				loading={list.isFetching}
				onPageChange={(page) => {
					setSelected([]);
					void setState({ page });
				}}
			/>

			<AlertDialog open={confirming} onOpenChange={setConfirming}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Remove {formatCount(selected.length, "lead")}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							They leave this list and nothing more is sent to them. Texts and
							consent records are kept.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => archive.mutate({ ids: selected })}
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function LeadsSearch({
	committed,
	commit,
}: {
	committed: string;
	commit: (value: string) => void;
}) {
	const [value, setValue] = useSearchInput(committed, commit);

	return (
		<InputGroup className="w-full sm:w-56">
			<InputGroupAddon>
				<Search />
			</InputGroupAddon>
			<InputGroupInput
				aria-label="Search leads"
				placeholder="Name or number"
				value={value}
				onChange={(event) => setValue(event.target.value)}
				autoComplete="off"
			/>
		</InputGroup>
	);
}
