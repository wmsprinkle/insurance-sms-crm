import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { ImportSkeleton } from "./import-skeleton";
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
						Add leads from a CSV file in three steps.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<ImportSkeleton />}>
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
