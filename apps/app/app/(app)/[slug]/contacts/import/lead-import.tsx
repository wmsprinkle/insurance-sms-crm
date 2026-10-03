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
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { SimpleTableRow } from "@crm/ui/components/simple-table";
import { Spinner } from "@crm/ui/components/spinner";
import { TableCell } from "@crm/ui/components/table";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	commitMapping,
	hasOptInEvidence,
	LEAD_FIELD_OPTIONS,
	LEAD_IMPORT,
	type LeadMapping,
	type LeadRow,
	missingRequiredFields,
	rejectionLabel,
	rowsForReview,
	withColumn,
} from "@/lib/lead-import";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

type ImportResult = RouterOutputs["leads"]["importPreview"];

const NOT_MAPPED = "__none__";

const STATUS_BADGE = {
	ready: { label: "Ready", variant: "secondary" },
	created: { label: "Created", variant: "default" },
	duplicate: { label: "Duplicate", variant: "outline" },
	rejected: { label: "Rejected", variant: "destructive" },
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
	{ id: "status", header: "Status", width: "w-[14%]" },
	{ id: "reasons", header: "Reasons" },
];

export function LeadImport() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const workspaceUrl = useWorkspaceUrl();
	const fileId = useId();

	const [fileName, setFileName] = useState<string | null>(null);
	const [csv, setCsv] = useState<string | null>(null);
	const [mapping, setMapping] = useState<LeadMapping>({});
	const [preview, setPreview] = useState<ImportResult | null>(null);
	const [committed, setCommitted] = useState<ImportResult | null>(null);

	const suggest = useMutation(
		trpc.leads.importPreview.mutationOptions({
			onSuccess: (result) => {
				setMapping(result.mapping);
				setPreview(null);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const check = useMutation(
		trpc.leads.importPreview.mutationOptions({
			onSuccess: setPreview,
			onError: (error) => toast.error(error.message),
		}),
	);

	const commit = useMutation(
		trpc.leads.importCommit.mutationOptions({
			onSuccess: async (result) => {
				setCommitted(result);
				await cache.contact();
				toast.success(
					result.totals.created === 1
						? "1 lead imported."
						: `${result.totals.created} leads imported.`,
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const reset = () => {
		setFileName(null);
		setCsv(null);
		setMapping({});
		setPreview(null);
		setCommitted(null);
		suggest.reset();
		check.reset();
		commit.reset();
	};

	const readFile = async (file: File | undefined) => {
		if (!file) return;
		if (file.size > LEAD_IMPORT.maxBytes) {
			toast.error(
				"That file is larger than 5 MB. Split it and import each part.",
			);
			return;
		}
		const text = await file.text();
		setFileName(file.name);
		setCsv(text);
		setCommitted(null);
		suggest.mutate({ csv: text });
	};

	const headers = suggest.data?.headers ?? [];
	const missing = missingRequiredFields(mapping);
	const ready = commitMapping(mapping);
	const busy = suggest.isPending || check.isPending || commit.isPending;

	if (committed) {
		return (
			<ImportDone
				result={committed}
				onAgain={reset}
				contactsHref={workspaceUrl("/contacts")}
			/>
		);
	}

	return (
		<div className="flex max-w-4xl flex-col gap-6">
			<Card>
				<CardHeader>
					<CardTitle>1. Upload</CardTitle>
					<CardDescription>
						A CSV with a header row. Up to 5 MB and 5,000 rows.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor={fileId}>CSV file</FieldLabel>
							<Input
								id={fileId}
								type="file"
								accept=".csv,text/csv"
								disabled={busy}
								onChange={(event) => void readFile(event.target.files?.[0])}
							/>
							<FieldDescription>
								{fileName
									? `${fileName} · ${headers.length} columns`
									: "Nothing is saved until you import."}
							</FieldDescription>
						</Field>
					</FieldGroup>
				</CardContent>
			</Card>

			{suggest.data ? (
				<Card>
					<CardHeader>
						<CardTitle>2. Match columns</CardTitle>
						<CardDescription>
							We guessed from the column names. Phone, consent source and
							consent date are required, plus an opt-in text or URL.
						</CardDescription>
						<CardAction>
							<Button
								variant="outline"
								disabled={busy || !csv || !ready}
								onClick={() => csv && check.mutate({ csv, mapping })}
							>
								{check.isPending ? <Spinner data-icon="inline-start" /> : null}
								Preview
							</Button>
						</CardAction>
					</CardHeader>
					<CardContent>
						<FieldGroup className="grid gap-4 sm:grid-cols-2">
							{LEAD_FIELD_OPTIONS.map((option) => (
								<ColumnPicker
									key={option.field}
									label={
										option.required
											? `${option.label} (required)`
											: option.label
									}
									value={mapping[option.field] ?? null}
									headers={headers}
									disabled={busy}
									onChange={(header) => {
										setMapping(withColumn(mapping, option.field, header));
										setPreview(null);
									}}
								/>
							))}
						</FieldGroup>
						{missing.length > 0 || !hasOptInEvidence(mapping) ? (
							<Alert className="mt-4">
								<AlertTitle>Not ready yet</AlertTitle>
								<AlertDescription>
									{[
										...LEAD_FIELD_OPTIONS.filter((option) =>
											missing.includes(option.field),
										).map(
											(option) =>
												`Pick a column for ${option.label.toLowerCase()}.`,
										),
										...(hasOptInEvidence(mapping)
											? []
											: [
													"Pick an opt-in text column, an opt-in URL column, or both.",
												]),
									].join(" ")}
								</AlertDescription>
							</Alert>
						) : null}
					</CardContent>
				</Card>
			) : null}

			{preview ? (
				<Card>
					<CardHeader>
						<CardTitle>3. Review</CardTitle>
						<CardDescription>
							{preview.totals.ready} ready, {preview.totals.duplicate} already
							in the CRM, {preview.totals.rejected} rejected, of{" "}
							{preview.totals.rows} rows. Only ready rows are imported.
						</CardDescription>
						<CardAction>
							<Button
								disabled={busy || !csv || !ready || preview.totals.ready === 0}
								onClick={() =>
									csv && ready && commit.mutate({ csv, mapping: ready })
								}
							>
								{commit.isPending ? (
									<Spinner data-icon="inline-start" />
								) : (
									<Icon icon={Upload} data-icon="inline-start" />
								)}
								Import {preview.totals.ready}
							</Button>
						</CardAction>
					</CardHeader>
					<CardContent>
						{preview.mappingIssues.length > 0 ? (
							<Alert variant="destructive" className="mb-4">
								<AlertTitle>Column problems</AlertTitle>
								<AlertDescription>
									{preview.mappingIssues.join(" ")}
								</AlertDescription>
							</Alert>
						) : null}
						<RowTable rows={preview.rows} />
					</CardContent>
				</Card>
			) : null}
		</div>
	);
}

function ColumnPicker({
	label,
	value,
	headers,
	disabled,
	onChange,
}: {
	label: string;
	value: string | null;
	headers: string[];
	disabled: boolean;
	onChange: (header: string | null) => void;
}) {
	const id = useId();

	return (
		<Field>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Select
				value={value ?? NOT_MAPPED}
				disabled={disabled}
				onValueChange={(next) => onChange(next === NOT_MAPPED ? null : next)}
			>
				<SelectTrigger id={id} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={NOT_MAPPED}>Not in this file</SelectItem>
					{headers.map((header) => (
						<SelectItem key={header} value={header}>
							{header}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</Field>
	);
}

function RowTable({ rows }: { rows: LeadRow[] }) {
	const shown = rowsForReview(rows).slice(0, LEAD_IMPORT.previewRows);

	if (shown.length === 0) {
		return <CardTableEmpty>The file has no data rows.</CardTableEmpty>;
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
							{row.reasons.map(rejectionLabel).join(", ") || "—"}
						</TableCell>
					</SimpleTableRow>
				))}
			</CardTable>
			{rows.length > shown.length ? (
				<CardTableEmpty>
					Showing {shown.length} of {rows.length} rows, problems first.
				</CardTableEmpty>
			) : null}
		</div>
	);
}

function ImportDone({
	result,
	onAgain,
	contactsHref,
}: {
	result: ImportResult;
	onAgain: () => void;
	contactsHref: string;
}) {
	return (
		<div className="flex max-w-4xl flex-col gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Import finished</CardTitle>
					<CardDescription>
						{result.totals.created} created, {result.totals.duplicate} already
						in the CRM, {result.totals.rejected} rejected.
					</CardDescription>
					<CardAction className="flex gap-2">
						<Button variant="outline" onClick={onAgain}>
							Import another file
						</Button>
						<Button asChild>
							<Link href={contactsHref}>Go to contacts</Link>
						</Button>
					</CardAction>
				</CardHeader>
				<CardContent>
					<RowTable rows={result.rows} />
				</CardContent>
			</Card>
		</div>
	);
}
