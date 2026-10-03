"use client";

import Download from "@carbon/icons-react/es/Download";
import Upload from "@carbon/icons-react/es/Upload";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Icon } from "@crm/ui/components/icon";
import { Spinner } from "@crm/ui/components/spinner";
import { cn } from "@crm/ui/lib/utils";
import { useId, useState } from "react";
import { LEAD_IMPORT } from "@/lib/lead-import";
import { SAMPLE_LEADS, sampleLeadsCsv } from "@/lib/sample-leads-csv";

const CONSENT_RULE =
	"Only import people who agreed to get texts from you. Every row needs where and when they agreed, and the words or page they agreed to.";

function downloadSample() {
	const blob = new Blob([sampleLeadsCsv()], { type: SAMPLE_LEADS.mimeType });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = SAMPLE_LEADS.fileName;
	link.click();
	URL.revokeObjectURL(url);
}

export function UploadStep({
	busy,
	onFile,
	onReject,
}: {
	busy: boolean;
	onFile: (file: File) => void;
	onReject: (message: string) => void;
}) {
	const inputId = useId();
	const [dragging, setDragging] = useState(false);

	const take = (file: File | undefined) => {
		if (!file) return;
		if (!file.name.toLowerCase().endsWith(".csv")) {
			onReject("That is not a CSV file. Save your sheet as CSV and try again.");
			return;
		}
		if (file.size > LEAD_IMPORT.maxBytes) {
			onReject(
				"That file is larger than 5 MB. Split it into smaller files and import each one.",
			);
			return;
		}
		onFile(file);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Upload your leads</CardTitle>
				<CardDescription>{CONSENT_RULE}</CardDescription>
				<CardAction>
					<Button variant="outline" onClick={downloadSample}>
						<Icon icon={Download} data-icon="inline-start" />
						Download sample CSV
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent>
				<label
					htmlFor={inputId}
					onDragOver={(event) => {
						event.preventDefault();
						setDragging(true);
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={(event) => {
						event.preventDefault();
						setDragging(false);
						take(event.dataTransfer.files[0]);
					}}
					className={cn(
						"flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 hover:bg-muted/50",
						dragging && "border-primary bg-muted",
						busy && "pointer-events-none opacity-60",
					)}
				>
					{busy ? <Spinner size="lg" /> : <Icon icon={Upload} />}
					<span className="font-medium text-sm">
						{busy
							? "Reading your file…"
							: "Drag a CSV here, or click to choose one"}
					</span>
					<span className="text-muted-foreground text-xs">
						A CSV with a header row. Up to 5 MB and 5,000 rows. Nothing is saved
						until you import.
					</span>
					<input
						id={inputId}
						type="file"
						accept=".csv,text/csv"
						className="sr-only"
						disabled={busy}
						onChange={(event) => {
							take(event.target.files?.[0]);
							event.target.value = "";
						}}
					/>
				</label>
			</CardContent>
		</Card>
	);
}
