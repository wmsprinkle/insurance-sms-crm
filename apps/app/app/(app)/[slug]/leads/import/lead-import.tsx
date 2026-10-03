"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { type CsvPreview, previewCsv } from "@/lib/csv-preview";
import {
	commitMapping,
	currentStep,
	type LeadMapping,
} from "@/lib/lead-import";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import { DoneStep } from "./done-step";
import { ImportStepper } from "./import-stepper";
import { MapStep } from "./map-step";
import { ReviewStep } from "./review-step";
import { UploadStep } from "./upload-step";

type ImportResult = RouterOutputs["leads"]["importPreview"];
type CommitResult = RouterOutputs["leads"]["importCommit"];

const PREVIEW_SAMPLE_ROWS = 3;

export function LeadImport() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const workspaceUrl = useWorkspaceUrl();

	const [fileName, setFileName] = useState<string | null>(null);
	const [csv, setCsv] = useState<string | null>(null);
	const [sample, setSample] = useState<CsvPreview>({ headers: [], rows: [] });
	const [mapping, setMapping] = useState<LeadMapping>({});
	const [preview, setPreview] = useState<ImportResult | null>(null);
	const [wantsReview, setWantsReview] = useState(false);
	const [committed, setCommitted] = useState<CommitResult | null>(null);

	const suggest = useMutation(
		trpc.leads.importPreview.mutationOptions({
			onSuccess: (result) => {
				setMapping(result.mapping);
				setPreview(null);
				setWantsReview(false);
			},
			onError: (error) => {
				setFileName(null);
				setCsv(null);
				toast.error(error.message);
			},
		}),
	);

	const check = useMutation(
		trpc.leads.importPreview.mutationOptions({
			onSuccess: (result) => {
				setPreview(result);
				setWantsReview(true);
			},
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
		setSample({ headers: [], rows: [] });
		setMapping({});
		setPreview(null);
		setWantsReview(false);
		setCommitted(null);
		suggest.reset();
		check.reset();
		commit.reset();
	};

	const readFile = async (file: File) => {
		const text = await file.text();
		setFileName(file.name);
		setCsv(text);
		setSample(previewCsv(text, PREVIEW_SAMPLE_ROWS));
		setCommitted(null);
		suggest.mutate({ csv: text });
	};

	const ready = commitMapping(mapping);
	const headers = suggest.data?.headers ?? sample.headers;

	if (committed) {
		return (
			<div className="flex max-w-4xl flex-col gap-6">
				<ImportStepper current="review" />
				<DoneStep
					result={committed}
					leadsHref={workspaceUrl("/leads")}
					onAgain={reset}
				/>
			</div>
		);
	}

	const step = currentStep({
		hasFile: Boolean(csv) && Boolean(suggest.data),
		hasPreview: preview !== null,
		wantsReview,
	});

	return (
		<div className="flex max-w-4xl flex-col gap-6">
			<ImportStepper current={step} />

			{step === "upload" ? (
				<UploadStep
					busy={suggest.isPending}
					onFile={(file) => void readFile(file)}
					onReject={(message) => toast.error(message)}
				/>
			) : null}

			{step === "map" && csv && fileName ? (
				<MapStep
					fileName={fileName}
					headers={headers}
					preview={sample}
					mapping={mapping}
					busy={check.isPending}
					canContinue={ready !== null}
					onChange={(next) => {
						setMapping(next);
						setPreview(null);
					}}
					onBack={reset}
					onNext={() => ready && check.mutate({ csv, mapping: ready })}
				/>
			) : null}

			{step === "review" && preview && csv ? (
				<ReviewStep
					preview={preview}
					busy={commit.isPending}
					onBack={() => setWantsReview(false)}
					onImport={() => ready && commit.mutate({ csv, mapping: ready })}
				/>
			) : null}
		</div>
	);
}
