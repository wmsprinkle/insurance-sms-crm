"use client";

import Send from "@carbon/icons-react/es/Send";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Icon } from "@crm/ui/components/icon";
import { Spinner } from "@crm/ui/components/spinner";
import { Textarea } from "@crm/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useDryRun } from "@/components/test-mode-banner";
import { LEADS } from "@/lib/leads";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

export function SmsTestTools({ contactId }: { contactId: string }) {
	const dryRun = useDryRun();
	const trpc = useTRPC();
	const cache = useCrmCache();
	const queryClient = useQueryClient();
	const [body, setBody] = useState("");

	const refresh = () =>
		Promise.all([
			cache.sms(),
			queryClient.invalidateQueries({ queryKey: trpc.today.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.smsDrafts.pathKey() }),
		]);

	const simulate = useMutation(
		trpc.sms.simulateInbound.mutationOptions({
			onSuccess: async (result) => {
				setBody("");
				toast.success(result.summary);
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const firstMessage = useMutation(
		trpc.sms.sendTestFirstMessage.mutationOptions({
			onSuccess: async (result) => {
				if (result.status === "sent") toast.success(result.summary);
				else toast.error(result.summary);
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!dryRun) return null;

	const text = body.trim();
	const busy = simulate.isPending || firstMessage.isPending;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Test tools</CardTitle>
				<CardDescription>
					Test mode only. These go through the real handling, but nothing is
					really sent.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<Button
					variant="outline"
					size="sm"
					className="self-start"
					disabled={busy}
					onClick={() => firstMessage.mutate({ contactId })}
				>
					{firstMessage.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<Icon icon={Send} data-icon="inline-start" />
					)}
					Send test first message
				</Button>

				<div className="flex flex-col gap-2">
					<Textarea
						aria-label="Simulated reply from the lead"
						placeholder="Type what the lead would text back"
						value={body}
						disabled={busy}
						onChange={(event) => setBody(event.target.value)}
					/>
					<div className="flex flex-wrap gap-1.5">
						{LEADS.quickReplies.map((reply) => (
							<Button
								key={reply}
								variant="outline"
								size="sm"
								disabled={busy}
								onClick={() => setBody(reply)}
							>
								{reply}
							</Button>
						))}
					</div>
					<Button
						size="sm"
						className="self-start"
						disabled={busy || text === ""}
						onClick={() => simulate.mutate({ contactId, body: text })}
					>
						{simulate.isPending ? <Spinner data-icon="inline-start" /> : null}
						Simulate reply
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
