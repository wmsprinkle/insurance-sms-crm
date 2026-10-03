"use client";

import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Button } from "@crm/ui/components/button";
import { PageShell, PageShellContent } from "@/components/page-shell";

export default function ImportError({
	error,
	reset,
}: {
	error: Error;
	reset: () => void;
}) {
	return (
		<PageShell>
			<PageShellContent>
				<Alert variant="destructive" className="max-w-xl">
					<AlertTitle>The import page did not load</AlertTitle>
					<AlertDescription>
						<p>{error.message}</p>
						<Button variant="outline" size="sm" onClick={reset}>
							Try again
						</Button>
					</AlertDescription>
				</Alert>
			</PageShellContent>
		</PageShell>
	);
}
