"use client";

import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Button } from "@crm/ui/components/button";
import {
	PageShell,
	PageShellContent,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";

export function PageError({
	title,
	error,
	reset,
}: {
	title: string;
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>{title}</PageShellTitle>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<Alert variant="destructive">
					<AlertTitle>Something went wrong</AlertTitle>
					<AlertDescription className="flex flex-col items-start gap-3">
						<span>{error.message || "An unexpected error happened."}</span>
						<Button variant="outline" size="sm" onClick={reset}>
							Try again
						</Button>
					</AlertDescription>
				</Alert>
			</PageShellContent>
		</PageShell>
	);
}
