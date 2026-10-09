import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
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
import { CalendarSettingsForm } from "./calendar-settings-form";
import { DraftsQueue } from "./drafts-queue";
import { LimitsSection } from "./limits-section";
import { SendingSwitch } from "./sending-switch";
import { SmsSettingsForm } from "./sms-settings-form";

export const metadata: Metadata = {
	title: "Compliance",
};

export default function ComplianceSettingsPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Compliance</PageShellTitle>
					<PageShellDescription>
						What leads get, how replies are handled, where meetings are booked
						and the rules that limit texting.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<Compliance />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Compliance() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await Promise.all([
		queryClient.prefetchQuery(trpc.sms.sendingState.queryOptions()),
		queryClient.prefetchQuery(trpc.settings.sms.queryOptions()),
		queryClient.prefetchQuery(trpc.settings.complianceLimits.queryOptions()),
		queryClient.prefetchQuery(trpc.settings.calendar.queryOptions()),
		queryClient.prefetchQuery(trpc.settings.quietHours.queryOptions()),
		queryClient.prefetchQuery(trpc.smsDrafts.queue.queryOptions()),
	]);

	return (
		<HydrateClient>
			<div className="flex max-w-4xl flex-col gap-6">
				<SendingSwitch />
				<SmsSettingsForm />
				<CalendarSettingsForm />
				<DraftsQueue />
				<LimitsSection />
			</div>
		</HydrateClient>
	);
}
