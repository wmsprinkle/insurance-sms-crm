import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellActions,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { TODAY_VIEW } from "@/lib/today";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { TodayImportButton } from "./today-import-button";
import { TodaySkeleton } from "./today-skeleton";
import { TodayView } from "./today-view";

export const metadata: Metadata = {
	title: "Today",
};

export default function TodayPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Today</PageShellTitle>
					<PageShellDescription>
						What needs you, who is booked and how the week is going.
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<TodayImportButton />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<TodaySkeleton />}>
					<TodayContent />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function TodayContent() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await Promise.all([
		queryClient.prefetchQuery(trpc.today.summary.queryOptions()),
		queryClient.prefetchQuery(trpc.smsDrafts.queue.queryOptions()),
		queryClient.prefetchQuery(
			trpc.sms.threadList.queryOptions({
				q: "",
				sort: "",
				dir: "asc",
				page: 1,
				pageSize: TODAY_VIEW.openThreadsPageSize,
				filter: "open",
			}),
		),
		queryClient.prefetchQuery(trpc.settings.sms.queryOptions()),
		queryClient.prefetchQuery(trpc.settings.calendar.queryOptions()),
		queryClient.prefetchQuery(trpc.workspace.get.queryOptions()),
	]);

	return (
		<HydrateClient>
			<TodayView />
		</HydrateClient>
	);
}
