import { defineHook } from "eve/hooks";
import { z } from "zod";

export const OUTBOUND_GUARD = {
	maxChars: 480,
	historyMessages: 16,
	historyMessageChars: 400,
	sendToolName: "send_sms",
	safeFallback:
		"Happy to help with that. Want me to have a licensed agent give you a quick call to go over it?",
} as const;

const INJECTION_PATTERNS: readonly RegExp[] = [
	/ignore (all |any |your |the )?(previous|prior|above|earlier)\s+(instruction|prompt|rule|direction)/i,
	/disregard (all |any |your |the )?(previous|prior|above|earlier)/i,
	/(system|initial|original)\s+(prompt|instruction|message)/i,
	/(repeat|print|show|reveal|output|display|tell me)\s+(me\s+)?(your|the)\s+(prompt|instruction|rule|system)/i,
	/you are now\b/i,
	/(act|behave|respond|roleplay|pretend)\s+as\s+(if\s+)?(a|an|you)\b/i,
	/\bDAN\b/,
	/\bjailbreak\b|developer mode/i,
	/forget (everything|all|your|what)/i,
	/new instruction/i,
	/<\/?(system|instruction|prompt)>/i,
];

const AI_TELL_PATTERNS: readonly RegExp[] = [
	/\bas an? (ai|a\.i\.|artificial intelligence|language model|llm)\b/i,
	/\bi(?:['’]m| am) an? (ai|a\.i\.|artificial intelligence|language model|llm|bot|chatbot|virtual assistant|automated)/i,
	/\b(ai|automated|virtual) assistant\b/i,
	/\bchat\s?bot\b/i,
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

export function detectInjection(text: string): boolean {
	if (!text) return false;
	return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function breaksCharacter(message: string): boolean {
	if (!message) return false;
	return (
		AI_TELL_PATTERNS.some((pattern) => pattern.test(message)) ||
		PROMPT_LEAK_PATTERNS.some((pattern) => pattern.test(message))
	);
}

export function stripContactInfo(
	message: string,
	bookingLink: string | null,
): string {
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
}): OutboundVerdict {
	if (breaksCharacter(input.message)) {
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

export const outboundSmsInput = z.object({ body: z.string() });

export function attemptedViolations(body: string): string[] {
	const violations: string[] = [];
	if (breaksCharacter(body)) violations.push("breaks_character");
	if (Array.from(body).length > OUTBOUND_GUARD.maxChars) {
		violations.push("over_length");
	}
	return violations;
}

export default defineHook({
	events: {
		"actions.requested"(event) {
			for (const action of event.data.actions) {
				if (action.kind !== "tool-call") continue;
				if (action.toolName !== OUTBOUND_GUARD.sendToolName) continue;

				const parsed = outboundSmsInput.safeParse(action.input);

				if (!parsed.success) {
					console.error(
						`[outbound-guard] ${action.toolName} input unreadable: ${parsed.error.message}`,
					);
					continue;
				}

				const violations = attemptedViolations(parsed.data.body);

				if (violations.length > 0) {
					console.error(
						`[outbound-guard] ${action.toolName} ${action.callId} attempted ${violations.join(", ")}`,
					);
				}
			}
		},
	},
});
