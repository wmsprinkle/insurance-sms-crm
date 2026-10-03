import type { SuppressionReason } from "@crm/db";
import { SMS } from "./sms-config";

export type SmsKeyword = keyof typeof SMS.keywords;

const KEYWORDS: readonly SmsKeyword[] = ["stop", "start", "help"];

export function normaliseKeyword(text: string): string {
	return text
		.trim()
		.replace(/^[\s"'.!?]+|[\s"'.!?]+$/g, "")
		.replace(/\s+/g, " ")
		.toUpperCase();
}

export function keywordOf(text: string): SmsKeyword | null {
	const candidate = normaliseKeyword(text);
	if (!candidate) return null;

	return (
		KEYWORDS.find((keyword) => {
			const words: readonly string[] = SMS.keywords[keyword];
			return words.includes(candidate);
		}) ?? null
	);
}

export function keywordReply(
	keyword: SmsKeyword,
	brand: string | null,
): string {
	const name = brand?.trim() || SMS.keywordReplies.brandFallback;
	return SMS.keywordReplies[keyword].replace("{brand}", name);
}

export type OptOutIntent = "opt_out" | "wrong_number";

const PHRASE_INTENTS: readonly OptOutIntent[] = ["wrong_number", "opt_out"];

function normalisePhrase(text: string): string {
	return text
		.toLowerCase()
		.replace(/[\u2018\u2019\u02bc]/g, "'")
		.replace(/[^a-z0-9'#]+/g, " ")
		.trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
	return ` ${haystack} `.includes(` ${phrase} `);
}

export function optOutIntentOf(text: string): OptOutIntent | null {
	const normalised = normalisePhrase(text);
	if (!normalised) return null;

	const intent = PHRASE_INTENTS.find((candidate) =>
		SMS.optOutPhrases[candidate].some((phrase) =>
			containsPhrase(normalised, phrase),
		),
	);
	if (intent) return intent;

	const [first] = normalised.split(" ");
	const leading: readonly string[] = SMS.optOutPhrases.leadingStopWords;
	return first && leading.includes(first.toUpperCase()) ? "opt_out" : null;
}

export function optOutConfirmationText(
	reason: SuppressionReason,
	brand: string | null,
): string {
	const name = brand?.trim() || SMS.keywordReplies.brandFallback;
	const template =
		reason === "WRONG_NUMBER"
			? SMS.keywordReplies.wrongNumber
			: SMS.keywordReplies.optOut;
	return template.replace("{brand}", name);
}
