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
