"use client";

import { Button } from "@crm/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@crm/ui/components/collapsible";
import { useQuery } from "@tanstack/react-query";
import { Item } from "@/components/crm/agent-panel";
import { LocalDateTime } from "@/components/local-date-time";
import { smsSessionViews } from "@/lib/sms-agent-session";
import { useTRPC } from "@/lib/trpc/client";

const TIME_OPTIONS = {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions;

export function SmsAgentSessions({ contactId }: { contactId: string }) {
	const trpc = useTRPC();
	const sessions = useQuery(trpc.sms.agentSessions.queryOptions({ contactId }));

	const views = smsSessionViews(sessions.data?.sessions ?? []);
	if (views.length === 0) return null;

	return (
		<div className="flex flex-col gap-2 border-b px-4 py-3 sm:px-5">
			{views.map((view) => (
				<Collapsible key={view.id}>
					<CollapsibleTrigger asChild>
						<Button variant="ghost" size="sm">
							Text conversation handled by the agent
						</Button>
					</CollapsibleTrigger>
					<p className="px-2 text-muted-foreground text-xs">
						Read only. Last activity{" "}
						<LocalDateTime date={view.lastEventAt} options={TIME_OPTIONS} />
						{sessions.data?.truncated ? ". Older steps are not shown." : "."}
					</p>
					<CollapsibleContent>
						<div className="flex max-h-96 flex-col gap-3 overflow-y-auto py-3">
							{view.transcript.flatMap((message) =>
								message.items.map((item) => <Item key={item.id} item={item} />),
							)}
						</div>
					</CollapsibleContent>
				</Collapsible>
			))}
		</div>
	);
}
