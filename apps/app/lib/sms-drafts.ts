import type { RouterOutputs } from "@/lib/trpc/types";

export type SmsSendOutcome = RouterOutputs["smsDrafts"]["approve"];

export type SmsOutcomeNotice = {
	sent: boolean;
	tone: "default" | "warning" | "destructive";
	title: string;
	description: string;
	retryAt: string | null;
	suggestion: string | null;
};

const BLOCKED = {
	"quiet-hours": {
		title: "Held for quiet hours",
		description:
			"The lead's local time is inside quiet hours. The text stays here until you approve it again.",
	},
	suppressed: {
		title: "Opted out",
		description:
			"This number replied STOP or asked not to be texted. Nothing can be sent to it.",
	},
	"no-consent": {
		title: "No consent on file",
		description:
			"The send gate blocks every text to a contact without an active consent record.",
	},
	"frequency-cap": {
		title: "Too many texts without an answer",
		description:
			"This lead already got the most texts allowed in a day or a week with no reply. Wait for an answer or try again later.",
	},
	"unsupported-number": {
		title: "Number not supported",
		description:
			"Only US numbers (+1) can be texted. Nothing can be sent to this one.",
	},
} satisfies Record<
	Extract<SmsSendOutcome, { status: "blocked" }>["reason"],
	{ title: string; description: string }
>;

const GUARDED = {
	sanitized:
		"The guard removed phone numbers, emails or links, or shortened the text. Review the suggestion and send it.",
	breaks_character:
		"The text reads like a bot or leaks instructions. The guard suggests a safe reply instead.",
	empty_after_sanitize:
		"Nothing was left after the guard removed contact details. The guard suggests a safe reply instead.",
	price_or_guarantee:
		"The text names a price or a guarantee. The guard suggests a safe reply instead.",
} satisfies Record<
	Extract<SmsSendOutcome, { status: "guarded" }>["reason"],
	string
>;

export function smsOutcomeNotice(outcome: SmsSendOutcome): SmsOutcomeNotice {
	switch (outcome.status) {
		case "sent":
			return {
				sent: true,
				tone: "default",
				title: outcome.dryRun ? "Recorded as sent (dry run)" : "Text sent",
				description: outcome.dryRun
					? "Dry run is on, so the SMS provider was not called."
					: "The SMS provider accepted the text.",
				retryAt: null,
				suggestion: null,
			};
		case "blocked":
			return {
				sent: false,
				tone: outcome.reason === "quiet-hours" ? "warning" : "destructive",
				...BLOCKED[outcome.reason],
				retryAt: outcome.retryAt,
				suggestion: null,
			};
		case "guarded":
			return {
				sent: false,
				tone: "warning",
				title: "Not sent: the guard changed the text",
				description: GUARDED[outcome.reason],
				retryAt: null,
				suggestion: outcome.suggestion,
			};
		case "failed":
			return {
				sent: false,
				tone: "destructive",
				title: "Not sent",
				description: outcome.error,
				retryAt: null,
				suggestion: null,
			};
	}
}

const SMS_TEXT_MAX_CHARS = 480;

export function smsTextProblem(text: string): string | null {
	const length = Array.from(text.trim()).length;
	if (length === 0) return "Write a message first.";
	if (length > SMS_TEXT_MAX_CHARS) {
		return `Keep it under ${SMS_TEXT_MAX_CHARS} characters (now ${length}).`;
	}
	return null;
}

export type BulkSendItem = {
	name: string;
	outcome: SmsSendOutcome;
};

export type BulkSendSummary = {
	total: number;
	sent: number;
	blocked: { title: string; count: number }[];
	headline: string;
	detail: string | null;
};

export function summarizeBulkSend(
	items: readonly BulkSendItem[],
): BulkSendSummary {
	let sent = 0;
	const reasons = new Map<string, number>();

	for (const item of items) {
		const notice = smsOutcomeNotice(item.outcome);
		if (notice.sent) {
			sent += 1;
			continue;
		}
		reasons.set(notice.title, (reasons.get(notice.title) ?? 0) + 1);
	}

	const blocked = [...reasons.entries()]
		.map(([title, count]) => ({ title, count }))
		.sort((a, b) => b.count - a.count);
	const notSent = items.length - sent;

	return {
		total: items.length,
		sent,
		blocked,
		headline:
			notSent === 0
				? `Sent ${sent} of ${items.length}`
				: `Sent ${sent} of ${items.length}. ${notSent} not sent`,
		detail:
			blocked.length === 0
				? null
				: blocked
						.map((reason) => `${reason.count} × ${reason.title}`)
						.join(", "),
	};
}

export type FirstMessageDraft = { id: string; name: string; body: string };

export function firstMessageDrafts(
	drafts: readonly (FirstMessageDraft & { firstMessage: boolean })[],
): FirstMessageDraft[] {
	return drafts
		.filter((draft) => draft.firstMessage)
		.map(({ id, name, body }) => ({ id, name, body }));
}
