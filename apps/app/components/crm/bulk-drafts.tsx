"use client";

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
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { type FirstMessageDraft, summarizeBulkSend } from "@/lib/sms-drafts";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

type Pending = "send" | "discard" | null;

function useRefreshDrafts() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const queryClient = useQueryClient();

	return () =>
		Promise.all([
			cache.sms(),
			queryClient.invalidateQueries({ queryKey: trpc.smsDrafts.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.today.pathKey() }),
		]);
}

export function BulkDraftActions({
	drafts,
}: {
	drafts: readonly FirstMessageDraft[];
}) {
	const trpc = useTRPC();
	const refresh = useRefreshDrafts();
	const [pending, setPending] = useState<Pending>(null);
	const workspace = useQuery(trpc.workspace.get.queryOptions());

	const sendAll = useMutation(
		trpc.smsDrafts.approveAll.mutationOptions({
			onSuccess: async ({ items }) => {
				const summary = summarizeBulkSend(items);
				const message = summary.detail
					? `${summary.headline}. ${summary.detail}.`
					: summary.headline;
				if (summary.sent === summary.total) toast.success(message);
				else if (summary.sent === 0) toast.error(message);
				else toast.warning(message);
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const discardAll = useMutation(
		trpc.smsDrafts.discardAll.mutationOptions({
			onSuccess: async ({ discarded }) => {
				toast.success(
					`Discarded ${discarded} ${discarded === 1 ? "draft" : "drafts"}.`,
				);
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!workspace.data?.canRename || drafts.length === 0) return null;

	const busy = sendAll.isPending || discardAll.isPending;
	const count = drafts.length;
	const noun = count === 1 ? "first message" : "first messages";
	const draftIds = drafts.map((draft) => draft.id);
	const example = drafts[0];

	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<Button size="sm" disabled={busy} onClick={() => setPending("send")}>
					{sendAll.isPending ? <Spinner data-icon="inline-start" /> : null}
					Send all drafts ({count})
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() => setPending("discard")}
				>
					{discardAll.isPending ? <Spinner data-icon="inline-start" /> : null}
					Discard all
				</Button>
			</div>

			<AlertDialog
				open={pending === "send"}
				onOpenChange={(open) => setPending(open ? "send" : null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Send {count} {noun}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Each text goes through the send gate on its own. Leads who opted
							out, have no consent or are in quiet hours are skipped. Replies to
							leads who already answered stay here for you to read.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{example ? (
						<figure className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
							<figcaption className="text-muted-foreground text-xs">
								{count === 1
									? `Text to ${example.name}`
									: `First text, to ${example.name}. The others use each lead's own name.`}
							</figcaption>
							<blockquote className="whitespace-pre-wrap">
								{example.body}
							</blockquote>
						</figure>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={() => sendAll.mutate({ draftIds })}>
							Send {count} {count === 1 ? "text" : "texts"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog
				open={pending === "discard"}
				onOpenChange={(open) => setPending(open ? "discard" : null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Discard {count} {noun}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							These leads get no text. You can still write to them from their
							lead page.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{example ? (
						<figure className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
							<figcaption className="text-muted-foreground text-xs">
								Not sent: {example.name}
								{count > 1 ? ` and ${count - 1} more` : ""}
							</figcaption>
							<blockquote className="whitespace-pre-wrap">
								{example.body}
							</blockquote>
						</figure>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => discardAll.mutate({ draftIds })}
						>
							Discard {count}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
