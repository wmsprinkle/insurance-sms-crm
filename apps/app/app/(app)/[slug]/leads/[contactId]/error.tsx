"use client";

import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Button } from "@crm/ui/components/button";
import Link from "next/link";
import { PageShell, PageShellContent } from "@/components/page-shell";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

export default function LeadError({
	error,
	reset,
}: {
	error: Error;
	reset: () => void;
}) {
	const workspaceUrl = useWorkspaceUrl();

	return (
		<PageShell>
			<PageShellContent>
				<Alert variant="destructive">
					<AlertTitle>Could not load this lead</AlertTitle>
					<AlertDescription>
						<p>{error.message}</p>
						<div className="flex gap-2">
							<Button variant="outline" size="sm" onClick={reset}>
								Try again
							</Button>
							<Button asChild variant="outline" size="sm">
								<Link href={workspaceUrl("/leads")}>Back to leads</Link>
							</Button>
						</div>
					</AlertDescription>
				</Alert>
			</PageShellContent>
		</PageShell>
	);
}
