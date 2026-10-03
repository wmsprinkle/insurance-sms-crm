import type { Metadata } from "next";
import { Suspense } from "react";
import { SmsNavLink } from "@/components/crm/sms-nav-link";
import {
	PageShell,
	PageShellActions,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { leadsListInput } from "@/lib/leads";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { loadLeadsSearchParams } from "./leads-search-params";
import { LeadsTable, LeadsTableSkeleton } from "./leads-table";

export const metadata: Metadata = {
	title: "Leads",
};

export default function LeadsPage({
	searchParams,
}: PageProps<"/[slug]/leads">) {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Leads</PageShellTitle>
					<PageShellDescription>
						Everyone you have imported, with where they are in the funnel.
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<SmsNavLink path="/leads/import" label="Import leads" />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<LeadsTableSkeleton />}>
					<LeadsContent searchParams={searchParams} />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function LeadsContent({
	searchParams,
}: Pick<PageProps<"/[slug]/leads">, "searchParams">) {
	const [, values] = await Promise.all([
		requireSession(),
		loadLeadsSearchParams(searchParams),
	]);

	await getServerQueryClient().prefetchQuery(
		getServerTrpc().today.leads.queryOptions(leadsListInput(values)),
	);

	return (
		<HydrateClient>
			<LeadsTable />
		</HydrateClient>
	);
}
