"use client";

import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

export function DraftsQueue() {
	const trpc = useTRPC();
	const workspaceUrl = useWorkspaceUrl();
	const queue = useQuery(trpc.smsDrafts.queue.queryOptions());

	const drafts = queue.data?.drafts.length ?? 0;
	const handoffs = queue.data?.handoffs.length ?? 0;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Drafts waiting for approval</CardTitle>
				<CardDescription>
					With automatic sending off, every reply the agent writes waits for a
					person to approve it.
				</CardDescription>
				<CardAction>
					<Button asChild variant="outline" size="sm">
						<Link href={workspaceUrl("/inbox/drafts")}>Open drafts</Link>
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent>
				<p className="text-muted-foreground text-xs">
					{queue.isPending
						? "Loading the queue."
						: queue.error
							? `Could not load the queue: ${queue.error.message}`
							: `${drafts} ${drafts === 1 ? "draft" : "drafts"} waiting · ${handoffs} ${handoffs === 1 ? "conversation" : "conversations"} with a person`}
				</p>
			</CardContent>
		</Card>
	);
}
