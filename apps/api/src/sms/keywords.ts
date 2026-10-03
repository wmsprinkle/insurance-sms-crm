import type { SuppressionReason } from "@crm/db";
import { SMS } from "./sms-config";

export type SmsKeyword = keyof typeof SMS.keywords;

const KEYWORDS: readonly SmsKeyword[] = ["stop", "start", "help"];

function normaliseKeyword(text: string): string {
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

const HOMOGLYPHS = new Map<string, string>(SMS.optOutPhrases.homoglyphs);
const SLANG = new Map<string, string>(SMS.optOutPhrases.slang);

const HOMOGLYPH_PATTERN = new RegExp(
	`[${[...HOMOGLYPHS.keys()].join("")}]`,
	"g",
);

function normalisePhrase(text: string): string {
	const folded = text
		.normalize("NFKC")
		.toLowerCase()
		.replace(HOMOGLYPH_PATTERN, (char) => HOMOGLYPHS.get(char) ?? char)
		.normalize("NFD")
		.replace(/\p{M}+/gu, "")
		.replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, "")
		.replace(/[\u2018\u2019\u02bc]/g, "'")
		.replace(/[^a-z0-9'#]+/g, " ")
		.trim();
	const joined = folded.replace(/\b(?:[a-z] ){2,}[a-z]\b/g, (run) =>
		run.replace(/ /g, ""),
	);
	const squeezed = joined.replace(/([a-z])\1{2,}/g, "$1");
	return squeezed
		.split(" ")
		.map((word) => SLANG.get(word) ?? word)
		.join(" ");
}

function containsPhrase(haystack: string, phrase: string): boolean {
	return ` ${haystack} `.includes(` ${phrase} `);
}

function hasStopWord(normalised: string): boolean {
	if (normalised.length > SMS.optOutPhrases.shortMessageMaxChars) return false;

	let rest = normalised;
	for (const benign of SMS.optOutPhrases.benignStop) {
		rest = rest.replace(new RegExp(benign, "g"), " ");
	}
	const stopWords: readonly string[] = SMS.optOutPhrases.stopWords;
	return rest.split(" ").some((word) => stopWords.includes(word));
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

	return hasStopWord(normalised) ? "opt_out" : null;
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
