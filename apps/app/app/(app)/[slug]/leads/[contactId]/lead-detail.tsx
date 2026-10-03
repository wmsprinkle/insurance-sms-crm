"use client";

import ArrowLeft from "@carbon/icons-react/es/ArrowLeft";
import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Icon } from "@crm/ui/components/icon";
import { Skeleton } from "@crm/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { LeadConsentCard } from "@/components/crm/lead-consent-card";
import { LeadStatusPill } from "@/components/crm/lead-status-pill";
import { LeadTimeline } from "@/components/crm/lead-timeline";
import { SmsThread } from "@/components/crm/sms-thread";
import { leadStatusMeta } from "@/lib/lead-status";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

export function LeadDetailSkeleton() {
	return (
		<div aria-busy="true" className="flex flex-col gap-4">
			<Skeleton className="h-8 w-64" />
			<div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
				<Skeleton className="h-96 w-full" />
				<Skeleton className="h-96 w-full" />
			</div>
			<span role="status" className="sr-only">
				Loading lead…
			</span>
		</div>
	);
}

export function LeadDetail({ contactId }: { contactId: string }) {
	const trpc = useTRPC();
	const workspaceUrl = useWorkspaceUrl();
	const lead = useQuery(trpc.today.lead.queryOptions({ contactId }));

	if (lead.error) {
		return (
			<Alert variant="destructive">
				<AlertTitle>Could not load this lead</AlertTitle>
				<AlertDescription>
					<p>{lead.error.message}</p>
					<Button variant="outline" size="sm" onClick={() => lead.refetch()}>
						Try again
					</Button>
				</AlertDescription>
			</Alert>
		);
	}

	if (!lead.data) return <LeadDetailSkeleton />;

	const data = lead.data;
	const meta = leadStatusMeta(data.status);

	return (
		<div className="flex flex-col gap-4">
			<header className="flex flex-col gap-2">
				<Button asChild variant="ghost" size="sm" className="self-start">
					<Link href={workspaceUrl("/leads")}>
						<Icon icon={ArrowLeft} data-icon="inline-start" />
						All leads
					</Link>
				</Button>
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="min-w-0 truncate font-medium text-2xl tracking-tight">
						{data.name}
					</h1>
					<LeadStatusPill status={data.status} />
				</div>
				<p className="text-muted-foreground text-sm">
					{[data.phone ?? "No phone number", data.email]
						.filter(Boolean)
						.join(" · ")}
				</p>
			</header>

			<div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
				<Card className="min-w-0">
					<CardHeader>
						<CardTitle>Conversation</CardTitle>
						<CardDescription>
							Write a text yourself at the bottom. It goes through the send
							gate.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex min-w-0 flex-col">
						<SmsThread contactId={contactId} />
					</CardContent>
				</Card>

				<div className="flex min-w-0 flex-col gap-4">
					<Card>
						<CardHeader>
							<CardTitle>Status</CardTitle>
							<CardDescription>{meta.help}</CardDescription>
						</CardHeader>
						{data.handoffOpen ? (
							<CardContent>
								<p className="text-sm">
									A person owns this conversation. The assistant sends nothing
									until you hand it back from Inbox, Drafts.
								</p>
							</CardContent>
						) : null}
					</Card>
					<LeadConsentCard
						consent={data.consent}
						suppression={data.suppression}
					/>
					<Card>
						<CardHeader>
							<CardTitle>Timeline</CardTitle>
						</CardHeader>
						<CardContent>
							<LeadTimeline events={data.timeline} />
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
