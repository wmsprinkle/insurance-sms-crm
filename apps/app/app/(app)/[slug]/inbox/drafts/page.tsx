import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxTabs } from "@/components/crm/inbox-tabs";
import { SmsDraftsQueue } from "@/components/crm/sms-drafts-queue";
import {
	PageShell,
	PageShellActions,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellLoading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";

export const metadata: Metadata = {
	title: "Inbox drafts",
};

export default function SmsDraftsPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Inbox</PageShellTitle>
					<PageShellDescription>
						Texts the agent held for a person, and conversations a person owns.
						Every approved text still passes the send gate.
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<InboxTabs active="drafts" />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<SmsDraftsContent />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function SmsDraftsContent() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(trpc.smsDrafts.queue.queryOptions());

	return (
		<HydrateClient>
			<SmsDraftsQueue />
		</HydrateClient>
	);
}
