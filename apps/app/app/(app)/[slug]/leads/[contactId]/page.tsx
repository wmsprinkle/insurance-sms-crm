import type { Metadata } from "next";
import { Suspense } from "react";
import { PageShell, PageShellContent } from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { LeadDetail, LeadDetailSkeleton } from "./lead-detail";

export const metadata: Metadata = {
	title: "Lead",
};

export default function LeadPage({
	params,
}: PageProps<"/[slug]/leads/[contactId]">) {
	return (
		<PageShell>
			<PageShellContent>
				<Suspense fallback={<LeadDetailSkeleton />}>
					<LeadContent params={params} />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function LeadContent({
	params,
}: Pick<PageProps<"/[slug]/leads/[contactId]">, "params">) {
	const [, { contactId }] = await Promise.all([requireSession(), params]);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await Promise.all([
		queryClient.prefetchQuery(trpc.today.lead.queryOptions({ contactId })),
		queryClient.prefetchQuery(trpc.sms.thread.queryOptions({ contactId })),
	]);

	return (
		<HydrateClient>
			<LeadDetail contactId={contactId} />
		</HydrateClient>
	);
}
