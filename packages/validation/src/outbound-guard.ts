import type { SmsDisclosureMode } from "./sms-settings";

export const OUTBOUND_GUARD = {
	maxChars: 480,
	safeFallback:
		"Happy to help with that. Want me to have a licensed agent give you a quick call to go over it?",
} as const;

const SELF_IDENTIFY_PATTERNS: readonly RegExp[] = [
	/\bi(?:['’]m| am) an? (bot|chatbot|virtual assistant|automated)/i,
	/\b(automated|virtual) assistant\b/i,
	/\bchat\s?bot\b/i,
];

const MODEL_TALK_PATTERNS: readonly RegExp[] = [
	/\bas an? (ai|a\.i\.|artificial intelligence|language model|llm)\b/i,
	/\bi(?:['’]m| am) an? (ai|a\.i\.|artificial intelligence|language model|llm)\b/i,
	/\bai assistant\b/i,
	/\blanguage model\b/i,
	/\bmy (training data|knowledge cutoff|programming)\b/i,
	/\bi (don['’]t|do not|cannot|can['’]t) have (the ability|access|feelings|personal)/i,
	/\bi was (trained|programmed|designed) (to|by)\b/i,
	/\b(openai|deepseek|anthropic|gpt)\b/i,
];

const PROMPT_LEAK_PATTERNS: readonly RegExp[] = [
	/STRICT RULES/i,
	/KNOWLEDGE \(/i,
	/untrusted data/i,
	/\bsystem prompt\b/i,
	/"action"\s*:/i,
	/\bsms-conduct\b|\bload_skill\b/i,
];

const URL_SPLIT_RE = /(https?:\/\/\S+|\bwww\.\S+)/i;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
const PHONE_RE =
	/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\b\d{10,11}\b/g;

function breaksCharacter(
	message: string,
	disclosure: SmsDisclosureMode,
): boolean {
	if (!message) return false;
	return (
		(disclosure === "deflect" &&
			SELF_IDENTIFY_PATTERNS.some((pattern) => pattern.test(message))) ||
		MODEL_TALK_PATTERNS.some((pattern) => pattern.test(message)) ||
		PROMPT_LEAK_PATTERNS.some((pattern) => pattern.test(message))
	);
}

function stripContactInfo(message: string, bookingLink: string | null): string {
	return message
		.split(URL_SPLIT_RE)
		.map((part, index) => {
			if (index % 2 === 1) {
				return bookingLink && part.startsWith(bookingLink) ? part : "";
			}
			return part.replace(EMAIL_RE, "").replace(PHONE_RE, "");
		})
		.join("")
		.replace(/\s{2,}/g, " ")
		.trim();
}

function capLength(message: string): string {
	return Array.from(message).slice(0, OUTBOUND_GUARD.maxChars).join("").trim();
}

export type OutboundVerdict =
	| { kind: "pass"; message: string }
	| { kind: "sanitized"; message: string }
	| {
			kind: "fallback";
			message: string;
			reason: "breaks_character" | "empty_after_sanitize";
	  };

export function guardOutbound(input: {
	message: string;
	bookingLink: string | null;
	disclosure: SmsDisclosureMode;
}): OutboundVerdict {
	if (breaksCharacter(input.message, input.disclosure)) {
		return {
			kind: "fallback",
			message: OUTBOUND_GUARD.safeFallback,
			reason: "breaks_character",
		};
	}

	const message = capLength(stripContactInfo(input.message, input.bookingLink));

	if (!message) {
		return {
			kind: "fallback",
			message: OUTBOUND_GUARD.safeFallback,
			reason: "empty_after_sanitize",
		};
	}

	return message === input.message.trim()
		? { kind: "pass", message }
		: { kind: "sanitized", message };
}
