"use client";

import Upload from "@carbon/icons-react/es/Upload";
import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { CardTable, CardTableEmpty } from "@crm/ui/components/card-table";
import { Checkbox } from "@crm/ui/components/checkbox";
import { Icon } from "@crm/ui/components/icon";
import { Label } from "@crm/ui/components/label";
import { SimpleTableRow } from "@crm/ui/components/simple-table";
import { Spinner } from "@crm/ui/components/spinner";
import { TableCell } from "@crm/ui/components/table";
import { useId, useState } from "react";
import {
	importBlockReason,
	importLabel,
	type LeadRow,
	rejectionLabel,
	visibleRows,
} from "@/lib/lead-import";
import type { RouterOutputs } from "@/lib/trpc/types";

type ImportResult = RouterOutputs["leads"]["importPreview"];

const STATUS_BADGE = {
	ready: { label: "Ready", variant: "secondary" },
	created: { label: "Imported", variant: "default" },
	duplicate: { label: "Already in CRM", variant: "outline" },
	rejected: { label: "Needs a fix", variant: "destructive" },
} as const satisfies Record<
	LeadRow["status"],
	{
		label: string;
		variant: "default" | "secondary" | "outline" | "destructive";
	}
>;

const ROW_COLUMNS = [
	{ id: "row", header: "Row", width: "w-[8%]" },
	{ id: "phone", header: "Phone", width: "w-[20%]" },
	{ id: "status", header: "Result", width: "w-[18%]" },
	{ id: "reasons", header: "What to fix" },
];

export function RowTable({
	rows,
	onlyProblems = false,
}: {
	rows: LeadRow[];
	onlyProblems?: boolean;
}) {
	const { shown, total } = visibleRows(rows, onlyProblems);

	if (shown.length === 0) {
		return (
			<CardTableEmpty>
				{onlyProblems
					? "No problems found. Every row is ready."
					: "The file has no data rows."}
			</CardTableEmpty>
		);
	}

	return (
		<div className="overflow-x-auto">
			<CardTable columns={ROW_COLUMNS}>
				{shown.map((row) => (
					<SimpleTableRow key={row.rowNumber}>
						<TableCell className="tabular-nums">{row.rowNumber}</TableCell>
						<TableCell className="truncate">{row.phone ?? "—"}</TableCell>
						<TableCell>
							<Badge variant={STATUS_BADGE[row.status].variant}>
								{STATUS_BADGE[row.status].label}
							</Badge>
						</TableCell>
						<TableCell className="whitespace-normal text-muted-foreground">
							{row.reasons.length > 0 ? (
								<ul className="flex flex-col gap-1">
									{row.reasons.map((reason) => (
										<li key={reason}>{rejectionLabel(reason)}</li>
									))}
								</ul>
							) : (
								"—"
							)}
						</TableCell>
					</SimpleTableRow>
				))}
			</CardTable>
			{total > shown.length ? (
				<CardTableEmpty>
					Showing {shown.length} of {total} rows, problems first.
				</CardTableEmpty>
			) : null}
		</div>
	);
}

export function ReviewStep({
	preview,
	busy,
	onBack,
	onImport,
}: {
	preview: ImportResult;
	busy: boolean;
	onBack: () => void;
	onImport: () => void;
}) {
	const filterId = useId();
	const [onlyProblems, setOnlyProblems] = useState(false);
	const { ready, duplicate, rejected, rows } = preview.totals;
	const blocked = importBlockReason(ready);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Review before you import</CardTitle>
				<CardDescription>
					{ready} ready, {duplicate} already in your CRM, {rejected} need a fix,
					out of {rows} rows. Only ready rows are imported.
				</CardDescription>
				<CardAction>
					<Button disabled={busy || blocked !== null} onClick={onImport}>
						{busy ? (
							<Spinner data-icon="inline-start" />
						) : (
							<Icon icon={Upload} data-icon="inline-start" />
						)}
						{importLabel(ready)}
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{blocked ? (
					<Alert variant="destructive">
						<AlertTitle>Nothing to import</AlertTitle>
						<AlertDescription>{blocked}</AlertDescription>
					</Alert>
				) : null}
				{preview.mappingIssues.length > 0 ? (
					<Alert variant="destructive">
						<AlertTitle>Column problems</AlertTitle>
						<AlertDescription>
							{preview.mappingIssues.join(" ")}
						</AlertDescription>
					</Alert>
				) : null}

				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-2">
						<Checkbox
							id={filterId}
							checked={onlyProblems}
							onCheckedChange={(next) => setOnlyProblems(next === true)}
						/>
						<Label htmlFor={filterId}>Show only problems</Label>
					</div>
					<Button variant="outline" disabled={busy} onClick={onBack}>
						Back to columns
					</Button>
				</div>

				<RowTable rows={preview.rows} onlyProblems={onlyProblems} />
			</CardContent>
		</Card>
	);
}
