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
	PageShellLoading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { Inbox } from "./inbox";
import { inboxListInput, loadInboxSearchParams } from "./inbox-search-params";

export const metadata: Metadata = {
	title: "Inbox",
};

export default function InboxPage({
	searchParams,
}: PageProps<"/[slug]/inbox">) {
	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Inbox</PageShellTitle>
					<PageShellDescription>
						Text conversations with leads. Open threads have a reply nobody has
						handled yet.
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<SmsNavLink path="/inbox/drafts" label="Drafts" />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<Suspense fallback={<PageShellLoading />}>
					<InboxContent searchParams={searchParams} />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function InboxContent({
	searchParams,
}: Pick<PageProps<"/[slug]/inbox">, "searchParams">) {
	const [, values] = await Promise.all([
		requireSession(),
		loadInboxSearchParams(searchParams),
	]);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	const contactId = values.conversation;

	await Promise.all([
		queryClient.prefetchQuery(
			trpc.sms.threadList.queryOptions(inboxListInput(values)),
		),
		contactId
			? queryClient.prefetchQuery(trpc.sms.thread.queryOptions({ contactId }))
			: null,
	]);

	return (
		<HydrateClient>
			<Inbox />
		</HydrateClient>
	);
}
