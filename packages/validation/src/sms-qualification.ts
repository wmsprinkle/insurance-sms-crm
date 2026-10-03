import { z } from "zod";

export const SMS_REPLY_CLASSES = [
	"opt_out",
	"wrong_number",
	"needs_human",
	"not_interested",
	"qualified",
	"interested",
	"question",
] as const;

export const smsReplyClass = z.enum(SMS_REPLY_CLASSES);

export type SmsReplyClass = z.infer<typeof smsReplyClass>;

export const INSURANCE_LINES = [
	"term_life",
	"whole_life",
	"final_expense",
	"health_individual",
	"health_family",
	"medicare_supplement",
	"other",
] as const;

export const AGE_BANDS = ["18-29", "30-39", "40-49", "50-64", "65+"] as const;

export const TIMELINES = [
	"now",
	"30_days",
	"90_days",
	"later",
	"unknown",
] as const;

export const QUALIFICATION_LIMITS = { coverageMaxLength: 120 } as const;

const COVERAGE_UNSAFE = /[^\p{L}\p{N} .,'&%$/+-]+/gu;

export function sanitizeCoverage(value: string): string {
	return value.replace(COVERAGE_UNSAFE, " ").replace(/\s+/g, " ").trim();
}

export const US_STATE_CODE = /^[A-Z]{2}$/;

export const qualificationFacts = z.object({
	line: z.enum(INSURANCE_LINES).optional(),
	state: z
		.string()
		.trim()
		.toUpperCase()
		.regex(US_STATE_CODE, "A state is a two-letter US code.")
		.optional(),
	ageBand: z.enum(AGE_BANDS).optional(),
	coverage: z
		.string()
		.max(QUALIFICATION_LIMITS.coverageMaxLength)
		.transform(sanitizeCoverage)
		.pipe(z.string().min(1))
		.optional(),
	timeline: z.enum(TIMELINES).optional(),
});

export type QualificationFacts = z.infer<typeof qualificationFacts>;

export type QualificationKey = keyof QualificationFacts;

export const QUALIFICATION_KEYS = [
	"line",
	"state",
	"ageBand",
	"coverage",
	"timeline",
] as const satisfies readonly QualificationKey[];

export const REQUIRED_QUALIFICATION_KEYS = [
	"line",
	"state",
	"ageBand",
	"timeline",
] as const satisfies readonly QualificationKey[];

export const QUALIFICATION_FIELD_LABELS = {
	line: "SMS line of insurance",
	state: "SMS state",
	ageBand: "SMS age band",
	coverage: "SMS coverage wanted",
	timeline: "SMS timeline",
} as const satisfies Record<QualificationKey, string>;

export const SMS_DEAL_STAGE = {
	opt_out: "UNQUALIFIED_TO_BUY",
	wrong_number: "UNQUALIFIED_TO_BUY",
	not_interested: "UNQUALIFIED_TO_BUY",
	qualified: "QUALIFIED_TO_BUY",
	needs_human: null,
	interested: null,
	question: null,
} as const satisfies Record<SmsReplyClass, string | null>;

export const SMS_NEXT_ACTION = {
	opt_out:
		"Call opt_out_contact with reason opt_out. Send nothing else; the code sends the one confirmation.",
	wrong_number:
		"Call opt_out_contact with reason wrong_number. Do not ask who they are.",
	needs_human:
		"Call handoff_to_human with one line on why. Then stop replying.",
	not_interested:
		"Send nothing. The code marks the lead not interested and stops. Call no other tool.",
	qualified: "Offer call times. Do not ask for more facts.",
	interested:
		"Answer from the knowledge skills, then ask for the next missing fact with send_sms.",
	question:
		"Answer from the knowledge skills in one or two short sentences, then ask for the next missing fact with send_sms.",
} as const satisfies Record<SmsReplyClass, string>;

export function strongestClass(
	values: readonly SmsReplyClass[],
): SmsReplyClass {
	const ranked = SMS_REPLY_CLASSES.filter((value) => values.includes(value));
	const first = ranked[0];
	if (!first) throw new Error("No reply class was given.");
	return first;
}

export type QualificationVerdict =
	| { status: "qualified" }
	| { status: "incomplete"; missing: QualificationKey[] }
	| { status: "disqualified"; reason: string };

export function judgeQualification(
	facts: QualificationFacts,
	licensedStates: readonly string[],
	flags: { underAge?: boolean } = {},
): QualificationVerdict {
	if (flags.underAge) {
		return { status: "disqualified", reason: "The lead is under 18." };
	}
	if (
		facts.state &&
		licensedStates.length > 0 &&
		!licensedStates.includes(facts.state)
	) {
		return {
			status: "disqualified",
			reason: `The agency is not licensed in ${facts.state}.`,
		};
	}

	const missing = REQUIRED_QUALIFICATION_KEYS.filter(
		(key) => facts[key] === undefined,
	);
	if (missing.length > 0) return { status: "incomplete", missing };

	return { status: "qualified" };
}
