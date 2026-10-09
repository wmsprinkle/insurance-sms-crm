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
import { Badge } from "@crm/ui/components/badge";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Switch } from "@crm/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

const COPY = {
	on: {
		title: "Start texting?",
		description:
			"Texts go to real phones from now on. Every text still passes the send gate: consent, opt-outs, quiet hours and the daily limit. You can pause texting at any time.",
		action: "Start texting",
	},
	off: {
		title: "Pause texting?",
		description:
			"No text leaves until you start texting again. New messages are saved and wait.",
		action: "Pause texting",
	},
} as const;

export function SendingSwitch() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const switchId = useId();
	const [confirming, setConfirming] = useState(false);

	const workspace = useQuery(trpc.workspace.get.queryOptions());
	const sending = useQuery(trpc.sms.sendingState.queryOptions());

	const save = useMutation(
		trpc.sms.setSending.mutationOptions({
			onSuccess: async (state) => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.sms.sendingState.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.today.summary.pathKey(),
					}),
				]);
				toast.success(state.live ? "Texting is live." : "Texting is paused.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!sending.data) return null;

	const state = sending.data;
	const canChange = workspace.data?.canRename === true;
	const next = state.live ? COPY.off : COPY.on;

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>Texting</CardTitle>
					<CardDescription>
						Start texting when your number is verified. Until then nothing is
						sent.
					</CardDescription>
					<CardAction>
						<Badge variant={state.live ? "default" : "secondary"}>
							{state.live ? "Live" : "Paused"}
						</Badge>
					</CardAction>
				</CardHeader>
				<CardContent>
					<div className="flex items-start justify-between gap-4">
						<div className="flex min-w-0 flex-col gap-1">
							<label htmlFor={switchId} className="font-medium text-sm">
								Send texts to leads
							</label>
							<p className="text-muted-foreground text-sm">
								{state.live
									? "On. Texts go to leads' phones."
									: "Off. Nothing is sent."}
								{canChange ? "" : " Only an owner or an admin can change this."}
							</p>
							{state.canGoLive ? null : (
								<p className="text-destructive text-sm">
									Texting cannot start yet. Add {state.missing.join(", ")} to
									the server settings first.
								</p>
							)}
						</div>
						<Switch
							id={switchId}
							checked={state.live}
							disabled={
								!canChange ||
								save.isPending ||
								(!state.live && !state.canGoLive)
							}
							onCheckedChange={() => setConfirming(true)}
						/>
					</div>
				</CardContent>
			</Card>

			<AlertDialog open={confirming} onOpenChange={setConfirming}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{next.title}</AlertDialogTitle>
						<AlertDialogDescription>{next.description}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => save.mutate({ live: !state.live })}
						>
							{next.action}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
