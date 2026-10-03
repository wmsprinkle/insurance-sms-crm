import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellFallback,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { MeetingsList } from "./meetings-list";

export const metadata: Metadata = {
	title: "Meetings",
};

export default function MeetingsPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Meetings</PageShellTitle>
					<PageShellDescription>
						Calls leads booked with you. Each one is on your Google Calendar.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<PageShellFallback />}>
					<MeetingsContent />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function MeetingsContent() {
	await requireSession();
	await getServerQueryClient().prefetchQuery(
		getServerTrpc().today.meetings.queryOptions(),
	);

	return (
		<HydrateClient>
			<MeetingsList />
		</HydrateClient>
	);
}
