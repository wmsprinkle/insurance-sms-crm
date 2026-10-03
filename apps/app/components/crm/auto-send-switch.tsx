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
import { Switch } from "@crm/ui/components/switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

const COPY = {
	on: {
		title: "Turn on auto-send?",
		description:
			"New leads get the first message right away, and the agent answers replies without waiting for you. Every text still passes the send gate: consent, opt-outs, quiet hours and the daily limit. You can turn it off at any time.",
		action: "Turn on auto-send",
	},
	off: {
		title: "Turn off auto-send?",
		description:
			"First messages and replies wait here as drafts until you send them. Nothing goes out on its own.",
		action: "Turn off auto-send",
	},
} as const;

export function AutoSendSwitch() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const switchId = useId();
	const [confirming, setConfirming] = useState(false);

	const workspace = useQuery(trpc.workspace.get.queryOptions());
	const sms = useQuery(trpc.settings.sms.queryOptions());

	const save = useMutation(
		trpc.settings.setSms.mutationOptions({
			onSuccess: async (saved) => {
				await cache.settings();
				toast.success(
					saved.settings.autoSend
						? "Auto-send is on."
						: "Auto-send is off. Texts wait for your OK.",
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!sms.data) return null;

	const settings = sms.data.settings;
	const canChange = workspace.data?.canRename === true;
	const next = settings.autoSend ? COPY.off : COPY.on;

	return (
		<>
			<div className="flex items-start justify-between gap-4 rounded-lg border p-4">
				<div className="flex min-w-0 flex-col gap-1">
					<label htmlFor={switchId} className="font-medium text-sm">
						Auto-send first messages
					</label>
					<p className="text-muted-foreground text-sm">
						{settings.autoSend
							? "On. New leads are texted right away."
							: "Off. You approve each first message before it goes out."}
						{canChange ? "" : " Only an owner or an admin can change this."}
					</p>
				</div>
				<Switch
					id={switchId}
					checked={settings.autoSend}
					disabled={!canChange || save.isPending}
					onCheckedChange={() => setConfirming(true)}
				/>
			</div>

			<AlertDialog open={confirming} onOpenChange={setConfirming}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{next.title}</AlertDialogTitle>
						<AlertDialogDescription>{next.description}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() =>
								save.mutate({ ...settings, autoSend: !settings.autoSend })
							}
						>
							{next.action}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
