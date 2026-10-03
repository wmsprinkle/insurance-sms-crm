"use client";

import Checkmark from "@carbon/icons-react/es/Checkmark";
import Reply from "@carbon/icons-react/es/Reply";
import TrashCan from "@carbon/icons-react/es/TrashCan";
import UserMultiple from "@carbon/icons-react/es/UserMultiple";
import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@crm/ui/components/empty";
import { Icon } from "@crm/ui/components/icon";
import { Spinner } from "@crm/ui/components/spinner";
import { Textarea } from "@crm/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AutoSendSwitch } from "@/components/crm/auto-send-switch";
import { BulkDraftActions } from "@/components/crm/bulk-drafts";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { SmsOutcomeAlert } from "@/components/crm/sms-outcome-alert";
import { LocalDateTime } from "@/components/local-date-time";
import {
	firstMessageDrafts,
	type SmsOutcomeNotice,
	smsOutcomeNotice,
	smsTextProblem,
} from "@/lib/sms-drafts";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type Queue = RouterOutputs["smsDrafts"]["queue"];
type DraftRow = Queue["drafts"][number];
type HandoffRow = Queue["handoffs"][number];

const TIME_OPTIONS = {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions;

function useRefreshQueue() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			cache.sms(),
			queryClient.invalidateQueries({ queryKey: trpc.smsDrafts.pathKey() }),
		]);
}

export function SmsDraftsQueue() {
	const trpc = useTRPC();
	const queue = useQuery(trpc.smsDrafts.queue.queryOptions());

	if (queue.isPending) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<Spinner />
			</div>
		);
	}

	if (queue.error) {
		return (
			<Alert variant="destructive">
				<AlertTitle>Could not load the drafts</AlertTitle>
				<AlertDescription>{queue.error.message}</AlertDescription>
			</Alert>
		);
	}

	const { drafts, handoffs, truncated } = queue.data;

	return (
		<div className="flex max-w-4xl flex-col gap-6">
			<AutoSendSwitch />

			<section className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<h2 className="font-medium">Drafts waiting for approval</h2>
					<Badge variant="secondary">{drafts.length}</Badge>
				</div>
				<BulkDraftActions drafts={firstMessageDrafts(drafts)} />
				{truncated ? (
					<p className="text-muted-foreground text-xs">
						Showing the oldest items first. Approve or discard some to see the
						rest.
					</p>
				) : null}
				{drafts.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Icon icon={Checkmark} />
							</EmptyMedia>
							<EmptyTitle>No drafts</EmptyTitle>
							<EmptyDescription>
								Texts the agent holds for a person show up here.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					drafts.map((draft) => <DraftCard key={draft.id} draft={draft} />)
				)}
			</section>

			<section className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<h2 className="font-medium">Handed to a person</h2>
					<Badge variant="secondary">{handoffs.length}</Badge>
				</div>
				{handoffs.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Icon icon={UserMultiple} />
							</EmptyMedia>
							<EmptyTitle>No handoffs</EmptyTitle>
							<EmptyDescription>
								Conversations the agent hands to a person show up here. The
								agent sends nothing to them until you hand them back.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					handoffs.map((handoff) => (
						<HandoffCard key={handoff.id} handoff={handoff} />
					))
				)}
			</section>
		</div>
	);
}

function DraftCard({ draft }: { draft: DraftRow }) {
	const trpc = useTRPC();
	const refresh = useRefreshQueue();
	const openRecord = useOpenRecord();
	const [text, setText] = useState(draft.body);
	const [notice, setNotice] = useState<SmsOutcomeNotice | null>(null);

	const approve = useMutation(
		trpc.smsDrafts.approve.mutationOptions({
			onSuccess: async (outcome) => {
				const next = smsOutcomeNotice(outcome);
				if (next.sent) {
					toast.success(next.title);
				} else {
					setNotice(next);
				}
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const discard = useMutation(
		trpc.smsDrafts.discard.mutationOptions({
			onSuccess: async ({ discarded }) => {
				toast.success(
					discarded ? "Draft discarded." : "This draft was already decided.",
				);
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const problem = smsTextProblem(text);
	const edited = text.trim() !== draft.body.trim();
	const busy = approve.isPending || discard.isPending;

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => openRecord({ kind: "contact", id: draft.contactId })}
					>
						{draft.name || "Unnamed contact"}
					</Button>
				</CardTitle>
				<CardDescription>
					{draft.phone ?? "No phone number"} · held{" "}
					<LocalDateTime date={draft.createdAt} options={TIME_OPTIONS} />
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<p className="text-muted-foreground text-xs">
					{draft.reasonLabel}
					{draft.retryAt ? (
						<>
							{" "}
							Allowed again from{" "}
							<LocalDateTime date={draft.retryAt} options={TIME_OPTIONS} />.
						</>
					) : null}
					{draft.handedOff
						? " A person owns this conversation; the agent sends nothing more."
						: null}
				</p>
				{notice ? (
					<SmsOutcomeAlert
						notice={notice}
						onUseSuggestion={(suggestion) => {
							setText(suggestion);
							setNotice(null);
						}}
					/>
				) : null}
				<Textarea
					aria-label={`Draft text for ${draft.name}`}
					value={text}
					onChange={(event) => setText(event.target.value)}
				/>
				{problem && text.trim() ? (
					<p className="text-destructive text-xs">{problem}</p>
				) : null}
			</CardContent>
			<CardFooter>
				<Button
					size="sm"
					disabled={busy || problem !== null}
					onClick={() =>
						approve.mutate({
							draftId: draft.id,
							text: edited ? text.trim() : undefined,
						})
					}
				>
					{approve.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<Icon icon={Checkmark} data-icon="inline-start" />
					)}
					{edited ? "Send edited text" : "Approve and send"}
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={() => discard.mutate({ draftId: draft.id })}
				>
					{discard.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<Icon icon={TrashCan} data-icon="inline-start" />
					)}
					Discard
				</Button>
				{edited ? (
					<Button
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => setText(draft.body)}
					>
						Reset
					</Button>
				) : null}
			</CardFooter>
		</Card>
	);
}

function HandoffCard({ handoff }: { handoff: HandoffRow }) {
	const trpc = useTRPC();
	const refresh = useRefreshQueue();
	const openRecord = useOpenRecord();

	const handBack = useMutation(
		trpc.smsDrafts.handBack.mutationOptions({
			onSuccess: async ({ resolved, queued }) => {
				if (!resolved) {
					toast.success("This conversation was already handed back.");
				} else {
					toast.success(
						queued
							? "Handed back. The agent answers the lead's latest texts."
							: "Handed back. The agent answers the lead's next text.",
					);
				}
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<Button
						variant="ghost"
						size="sm"
						onClick={() =>
							openRecord({ kind: "contact", id: handoff.contactId })
						}
					>
						{handoff.name || "Unnamed contact"}
					</Button>
				</CardTitle>
				<CardDescription>
					{handoff.phone ?? "No phone number"} · since{" "}
					<LocalDateTime date={handoff.createdAt} options={TIME_OPTIONS} />
				</CardDescription>
			</CardHeader>
			<CardContent>
				<p className="text-xs">{handoff.reason}</p>
			</CardContent>
			<CardFooter>
				<Button
					variant="outline"
					size="sm"
					disabled={handBack.isPending}
					onClick={() => handBack.mutate({ contactId: handoff.contactId })}
				>
					{handBack.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<Icon icon={Reply} data-icon="inline-start" />
					)}
					Hand back to agent
				</Button>
			</CardFooter>
		</Card>
	);
}
