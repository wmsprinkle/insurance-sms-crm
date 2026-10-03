import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { LocalDateTime } from "@/components/local-date-time";
import { CONSENT_SOURCE_LABELS, SUPPRESSION_LABELS } from "@/lib/leads";
import type { RouterOutputs } from "@/lib/trpc/types";

type Lead = RouterOutputs["today"]["lead"];

const WHEN_OPTIONS = {
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions;

export function LeadConsentCard({
	consent,
	suppression,
}: Pick<Lead, "consent" | "suppression">) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Consent</CardTitle>
				<CardDescription>
					Proof that this person agreed to get texts.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{suppression ? (
					<Alert variant="destructive">
						<AlertTitle>Opted out</AlertTitle>
						<AlertDescription>
							{SUPPRESSION_LABELS[suppression.reason]} Nothing more is sent
							unless they reply START.
						</AlertDescription>
					</Alert>
				) : null}
				{consent ? (
					<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
						<dt className="text-muted-foreground">Source</dt>
						<dd>{CONSENT_SOURCE_LABELS[consent.source]}</dd>
						<dt className="text-muted-foreground">Agreed on</dt>
						<dd>
							<LocalDateTime date={consent.capturedAt} options={WHEN_OPTIONS} />
						</dd>
						<dt className="text-muted-foreground">Opt-in text</dt>
						<dd className="whitespace-pre-wrap break-words">
							{consent.optInText ?? "Not recorded"}
						</dd>
						<dt className="text-muted-foreground">Opt-in page</dt>
						<dd className="break-all">{consent.optInUrl ?? "Not recorded"}</dd>
						{consent.revokedAt ? (
							<>
								<dt className="text-muted-foreground">Withdrawn</dt>
								<dd>
									<LocalDateTime
										date={consent.revokedAt}
										options={WHEN_OPTIONS}
									/>
								</dd>
							</>
						) : null}
					</dl>
				) : (
					<Alert variant="destructive">
						<AlertTitle>No consent on file, texts are blocked</AlertTitle>
						<AlertDescription>
							Import this lead again with a consent source, date and opt-in
							proof.
						</AlertDescription>
					</Alert>
				)}
			</CardContent>
		</Card>
	);
}
