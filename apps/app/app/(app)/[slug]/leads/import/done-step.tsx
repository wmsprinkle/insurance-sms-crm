"use client";

import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import Link from "next/link";
import type { RouterOutputs } from "@/lib/trpc/types";
import { RowTable } from "./review-step";

export function DoneStep({
	result,
	leadsHref,
	onAgain,
}: {
	result: RouterOutputs["leads"]["importCommit"];
	leadsHref: string;
	onAgain: () => void;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Import finished</CardTitle>
				<CardDescription>
					{result.totals.created} imported, {result.totals.duplicate} already in
					your CRM, {result.totals.rejected} skipped.
				</CardDescription>
				<CardAction className="flex gap-2">
					<Button variant="outline" onClick={onAgain}>
						Import another file
					</Button>
					<Button asChild>
						<Link href={leadsHref}>View leads</Link>
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent>
				<RowTable rows={result.rows} onlyProblems />
			</CardContent>
		</Card>
	);
}
