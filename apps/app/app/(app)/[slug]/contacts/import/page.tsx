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
import { LeadImport } from "./lead-import";

export const metadata: Metadata = {
	title: "Import leads",
};

export default function ImportLeadsPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Import leads</PageShellTitle>
					<PageShellDescription>
						Upload a CSV of leads who agreed to receive texts. Every row needs a
						phone number and proof of consent.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<ImportLeads />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function ImportLeads() {
	await requireSession();
	return <LeadImport />;
}
