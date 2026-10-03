"use client";

import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@crm/ui/components/field";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Spinner } from "@crm/ui/components/spinner";
import { useId } from "react";
import {
	type ColumnSample,
	type CsvPreview,
	columnSamples,
} from "@/lib/csv-preview";
import {
	LEAD_FIELD_OPTIONS,
	type LeadMapping,
	mappingBlockers,
	withColumn,
} from "@/lib/lead-import";

const NOT_MAPPED = "__none__";

export function MapStep({
	fileName,
	headers,
	preview,
	mapping,
	busy,
	canContinue,
	onChange,
	onBack,
	onNext,
}: {
	fileName: string;
	headers: string[];
	preview: CsvPreview;
	mapping: LeadMapping;
	busy: boolean;
	canContinue: boolean;
	onChange: (mapping: LeadMapping) => void;
	onBack: () => void;
	onNext: () => void;
}) {
	const blockers = mappingBlockers(mapping);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Match your columns</CardTitle>
				<CardDescription>
					{fileName} has {headers.length} columns. We guessed from the column
					names. Check each one. Fields marked required must have a column.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<FieldGroup className="grid gap-4 sm:grid-cols-2">
					{LEAD_FIELD_OPTIONS.map((option) => (
						<ColumnPicker
							key={option.field}
							label={option.label}
							required={option.required}
							value={mapping[option.field] ?? null}
							headers={headers}
							samples={columnSamples(preview, mapping[option.field])}
							disabled={busy}
							onChange={(header) =>
								onChange(withColumn(mapping, option.field, header))
							}
						/>
					))}
				</FieldGroup>

				{blockers.length > 0 ? (
					<Alert>
						<AlertTitle>Not ready yet</AlertTitle>
						<AlertDescription>
							<ul className="list-disc pl-4">
								{blockers.map((blocker) => (
									<li key={blocker}>{blocker}</li>
								))}
							</ul>
						</AlertDescription>
					</Alert>
				) : null}

				<div className="flex items-center justify-between gap-3">
					<Button variant="outline" disabled={busy} onClick={onBack}>
						Choose another file
					</Button>
					<Button disabled={busy || !canContinue} onClick={onNext}>
						{busy ? <Spinner data-icon="inline-start" /> : null}
						Check my leads
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function ColumnPicker({
	label,
	required,
	value,
	headers,
	samples,
	disabled,
	onChange,
}: {
	label: string;
	required: boolean;
	value: string | null;
	headers: string[];
	samples: ColumnSample[];
	disabled: boolean;
	onChange: (header: string | null) => void;
}) {
	const id = useId();

	return (
		<Field>
			<FieldLabel htmlFor={id}>
				{label}
				{required ? (
					<span className="text-muted-foreground font-normal"> (required)</span>
				) : null}
			</FieldLabel>
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
			{samples.length > 0 ? (
				<ul
					aria-label={`First rows of ${value}`}
					className="flex flex-col text-muted-foreground text-xs"
				>
					{samples.map((sample) => (
						<li key={sample.rowNumber} className="truncate">
							{sample.text || "(empty)"}
						</li>
					))}
				</ul>
			) : null}
		</Field>
	);
}
