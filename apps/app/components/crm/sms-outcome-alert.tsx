"use client";

import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Button } from "@crm/ui/components/button";
import { LocalDateTime } from "@/components/local-date-time";
import type { SmsOutcomeNotice } from "@/lib/sms-drafts";

const RETRY_OPTIONS = {
	weekday: "short",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions;

export function SmsOutcomeAlert({
	notice,
	onUseSuggestion,
}: {
	notice: SmsOutcomeNotice;
	onUseSuggestion: (text: string) => void;
}) {
	const suggestion = notice.suggestion;

	return (
		<Alert variant={notice.tone}>
			<AlertTitle>{notice.title}</AlertTitle>
			<AlertDescription>
				<p>{notice.description}</p>
				{notice.retryAt ? (
					<p>
						Allowed again from{" "}
						<LocalDateTime date={notice.retryAt} options={RETRY_OPTIONS} />.
					</p>
				) : null}
				{suggestion ? (
					<div className="flex flex-col items-start gap-2">
						<p className="whitespace-pre-wrap">Suggestion: {suggestion}</p>
						<Button
							variant="outline"
							size="sm"
							onClick={() => onUseSuggestion(suggestion)}
						>
							Use suggestion
						</Button>
					</div>
				) : null}
			</AlertDescription>
		</Alert>
	);
}
