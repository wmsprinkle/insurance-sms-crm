import { SMS_DISCLOSURE_MODES, type SmsDisclosureMode } from "./sms-settings";

export const OUTBOUND_GUARD = {
	maxChars: 320,
	safeFallback:
		"Happy to help with that. Want me to have a licensed agent give you a quick call to go over it?",
} as const;

export const DISCLOSURE_MODES = SMS_DISCLOSURE_MODES;

export type DisclosureMode = SmsDisclosureMode;

const INJECTION_PATTERNS: readonly RegExp[] = [
	/ignore\b.{0,40}\b(instruction|prompt|rule|direction|guideline)/i,
	/disregard\b.{0,40}\b(previous|prior|above|earlier|instruction|prompt|rule)/i,
	/(system|initial|original|hidden)\s+(prompt|instruction|message)/i,
	/(repeat|print|show|reveal|output|display|tell me)\s+(me\s+)?(your|the)\s+(prompt|instruction|rule|system)/i,
	/\byou\s*(are|re|'re|’re)\s+now\b/i,
	/\bfrom now on\b.{0,20}\byou\b/i,
	/(act|behave|respond|roleplay|pretend)\s+(as|like)\s+(if\s+)?(a|an|you|my)\b/i,
	/\bjailbreak\b|developer mode/i,
	/forget (everything|all|your|what)/i,
	/new (instruction|rule|prompt)/i,
	/<\/?(system|instruction|prompt|assistant)>/i,
	/^\s*(system|assistant|developer)\s*:/im,
	/<<<|>>>/,
];

const RAW_INJECTION_PATTERNS: readonly RegExp[] = [/\bDAN\b/];

const LEET_FROM = "013457@$";
const LEET_TO = "oieastas";

const INVISIBLE_RE = /[​-‍⁠﻿­]/g;

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

const PRICE_PATTERNS: readonly RegExp[] = [
	/[$€£]\s?[\d０-９]/,
	/[\d０-９]\s?(dollars|bucks|usd)\b/i,
	/[\d０-９]\s*(\/|a|per)\s*(mo|month|year|yr|week)\b/i,
	/\bguarantee/i,
];

const DIGIT = "[0-9\\uFF10-\\uFF19]";
const SEP = "[\\s.\\-\\u2010-\\u2015\\u30FC\\uFF0D]";

const URL_SPLIT_RE = /(https?:\/\/\S+|\bwww\.\S+)/i;
const SHORTENER_TLDS =
	"com|net|org|info|biz|io|co|ly|gl|app|link|xyz|site|online|page|ai|gg|cc|tv|ws|club|shop|store|insure|insurance";
const BARE_DOMAIN_RE = new RegExp(
	`\\b[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:[a-z]{2,24}\\/\\S*|(?:${SHORTENER_TLDS})\\b)`,
	"gi",
);
const EMAIL_RE = /\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g;
const PHONE_RE = new RegExp(
	[
		`\\+\\s?${DIGIT}(?:[\\s().\\-]*${DIGIT}){6,14}`,
		`(?:\\+?1${SEP}?)?\\(?${DIGIT}{3}\\)?${SEP}${DIGIT}{3}${SEP}${DIGIT}{4}(?!${DIGIT})`,
		`(?<!${DIGIT})${DIGIT}{10,11}(?!${DIGIT})`,
		`(?<![\\d$,.])${DIGIT}{3}${SEP}${DIGIT}{4}(?!${DIGIT})`,
	].join("|"),
	"g",
);
const TRAILING_PUNCTUATION_RE = /[.,!?;:)\]'"’”]+$/;

export function normalizeForInjection(text: string): string {
	return Array.from(
		text.normalize("NFKC").replace(INVISIBLE_RE, "").toLowerCase(),
	)
		.map((char) => {
			const index = LEET_FROM.indexOf(char);
			return index === -1 ? char : (LEET_TO[index] ?? char);
		})
		.join("")
		.replace(/\s+/g, " ")
		.trim();
}

export function detectInjection(text: string): boolean {
	if (!text) return false;
	if (RAW_INJECTION_PATTERNS.some((pattern) => pattern.test(text))) return true;
	const collapsed = text.normalize("NFKC").replace(INVISIBLE_RE, "");
	const normalized = normalizeForInjection(text);
	return INJECTION_PATTERNS.some(
		(pattern) => pattern.test(collapsed) || pattern.test(normalized),
	);
}

export function breaksCharacter(
	message: string,
	disclosure: DisclosureMode,
): boolean {
	if (!message) return false;
	return (
		(disclosure === "deflect" &&
			SELF_IDENTIFY_PATTERNS.some((pattern) => pattern.test(message))) ||
		MODEL_TALK_PATTERNS.some((pattern) => pattern.test(message)) ||
		PROMPT_LEAK_PATTERNS.some((pattern) => pattern.test(message))
	);
}

export function mentionsPrice(message: string): boolean {
	return PRICE_PATTERNS.some((pattern) => pattern.test(message));
}

function parseLink(text: string): URL | null {
	const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`;
	return URL.canParse(candidate) ? new URL(candidate) : null;
}

export function isBookingLink(candidate: string, bookingLink: string): boolean {
	const link = parseLink(bookingLink);
	const url = parseLink(candidate);
	if (!link || !url) return false;
	if (url.username || url.password) return false;
	if (url.protocol !== link.protocol || url.host !== link.host) return false;

	const base = link.pathname.replace(/\/+$/, "");
	return (
		url.pathname === link.pathname ||
		url.pathname === base ||
		url.pathname.startsWith(`${base}/`)
	);
}

function keepUrl(part: string, bookingLink: string | null): string {
	if (!bookingLink) return "";
	const trailing = part.match(TRAILING_PUNCTUATION_RE)?.[0] ?? "";
	const url = trailing ? part.slice(0, -trailing.length) : part;
	return isBookingLink(url, bookingLink) ? part : "";
}

export function stripContactInfo(
	message: string,
	bookingLink: string | null,
): string {
	return message
		.split(URL_SPLIT_RE)
		.map((part, index) => {
			if (index % 2 === 1) return keepUrl(part, bookingLink);
			return part
				.replace(EMAIL_RE, "")
				.replace(BARE_DOMAIN_RE, "")
				.replace(PHONE_RE, "");
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
			reason:
				| "breaks_character"
				| "price_or_guarantee"
				| "empty_after_sanitize";
	  };

export function guardOutbound(input: {
	message: string;
	bookingLink: string | null;
	disclosure: DisclosureMode;
}): OutboundVerdict {
	if (breaksCharacter(input.message, input.disclosure)) {
		return {
			kind: "fallback",
			message: OUTBOUND_GUARD.safeFallback,
			reason: "breaks_character",
		};
	}

	if (mentionsPrice(input.message)) {
		return {
			kind: "fallback",
			message: OUTBOUND_GUARD.safeFallback,
			reason: "price_or_guarantee",
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
