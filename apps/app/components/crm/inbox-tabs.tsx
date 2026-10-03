"use client";

import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import { cn } from "@crm/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

type InboxSection = "conversations" | "drafts";

export function InboxTabs({ active }: { active: InboxSection }) {
	const workspaceUrl = useWorkspaceUrl();
	const trpc = useTRPC();
	const queue = useQuery(trpc.smsDrafts.queue.queryOptions());
	const waiting = queue.data
		? queue.data.drafts.length + queue.data.handoffs.length
		: 0;

	return (
		<nav aria-label="Inbox sections" className="flex items-center gap-1">
			<InboxTabLink
				href={workspaceUrl("/inbox")}
				current={active === "conversations"}
			>
				Conversations
			</InboxTabLink>
			<InboxTabLink
				href={workspaceUrl("/inbox/drafts")}
				current={active === "drafts"}
			>
				Drafts
				{waiting > 0 ? (
					<Badge variant="secondary" aria-label={`${waiting} waiting`}>
						{waiting}
					</Badge>
				) : null}
			</InboxTabLink>
		</nav>
	);
}

function InboxTabLink({
	href,
	current,
	children,
}: {
	href: string;
	current: boolean;
	children: React.ReactNode;
}) {
	return (
		<Button
			asChild
			variant="ghost"
			size="sm"
			className={cn(
				"gap-2 text-muted-foreground",
				current && "bg-muted text-foreground hover:bg-muted",
			)}
		>
			<Link href={href} aria-current={current ? "page" : undefined}>
				{children}
			</Link>
		</Button>
	);
}
