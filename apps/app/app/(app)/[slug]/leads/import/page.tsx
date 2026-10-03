import { Skeleton } from "@crm/ui/components/skeleton";
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

export function ImportSkeleton() {
	return (
		<div aria-busy="true" className="flex max-w-4xl flex-col gap-6">
			<Skeleton className="h-6 w-80 max-w-full" />
			<Skeleton className="h-64 w-full rounded-lg" />
			<span role="status" className="sr-only">
				Loading the import…
			</span>
		</div>
	);
}

async function ImportLeads() {
	await requireSession();
	return <LeadImport />;
}
