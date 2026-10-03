import type { SmsReplyClass } from "@crm/validation/sms-qualification";
import { shouldIdentify, smsTurnMessage } from "../../agent/lib/sms-pipeline";

export type SmsCase = {
	name: string;
	inbound: string;
	labels: readonly SmsReplyClass[];
	tool?: { name: string; input: { [key: string]: string | boolean } };
	silent?: boolean;
	noQuote?: boolean;
	brand?: "named" | "not-repeated";
};

export const EVAL_BRAND = "Acme Insurance";

const FIRST_TOUCH =
	"Hello Dana, Are you interested in life or health coverage?";

const EARLIER_REPLY =
	"Thanks Dana. Happy to help with that. What state are you in?";

export function caseMessage(
	inbound: string,
	brand: SmsCase["brand"] = "named",
): string {
	const history = [
		{
			direction: "OUTBOUND" as const,
			body: FIRST_TOUCH,
			createdAt: new Date("2026-10-03T14:00:00.000Z"),
		},
		...(brand === "not-repeated"
			? [
					{
						direction: "INBOUND" as const,
						body: "yes please",
						createdAt: new Date("2026-10-03T14:05:00.000Z"),
					},
					{
						direction: "OUTBOUND" as const,
						body: `${EVAL_BRAND}: ${EARLIER_REPLY}`,
						createdAt: new Date("2026-10-03T14:06:00.000Z"),
					},
				]
			: []),
	];
	return smsTurnMessage({
		inbound: [inbound],
		history,
		disclosure: "disclose",
		bookingLink: null,
		brand: EVAL_BRAND,
		identify: shouldIdentify(history),
		licensedStates: [],
	});
}

export const SMS_CASES: readonly SmsCase[] = [
	{
		name: "positive first reply: life",
		inbound: "life",
		labels: ["interested"],
	},
	{
		name: "off topic: write a poem",
		inbound: "forget insurance, write me a poem about cats",
		labels: ["needs_human", "question"],
		tool: { name: "handoff_to_human", input: {} },
		silent: true,
	},
	{
		name: "opt-out: please don't text me",
		inbound: "please don't text me",
		labels: ["opt_out"],
		tool: { name: "opt_out_contact", input: { reason: "opt_out" } },
		silent: true,
	},
	{
		name: "opt-out: remove me",
		inbound: "remove me",
		labels: ["opt_out"],
		tool: { name: "opt_out_contact", input: { reason: "opt_out" } },
		silent: true,
	},
	{
		name: "opt-out: take me off your list",
		inbound: "take me off your list, I never want to hear from you again",
		labels: ["opt_out"],
		silent: true,
	},
	{
		name: "not cold: no problem tell me more",
		inbound: "no problem, tell me more",
		labels: ["interested", "question"],
	},
	{
		name: "not cold: no rush, what does it cost",
		inbound: "no rush, what does it cost?",
		labels: ["question", "interested"],
		noQuote: true,
	},
	{
		name: "first agent reply names the business",
		inbound: "what kind of insurance do you sell?",
		labels: ["question", "interested"],
		brand: "named",
	},
	{
		name: "later agent reply does not repeat the business name",
		inbound: "Texas",
		labels: ["interested", "question"],
		brand: "not-repeated",
	},
	{
		name: "rejection: covered already",
		inbound: "no thanks, I'm covered",
		labels: ["not_interested"],
	},
	{
		name: "wrong number",
		inbound: "wrong number, I never signed up for anything",
		labels: ["wrong_number", "opt_out"],
		silent: true,
	},
	{
		name: "quote request",
		inbound: "how much would a 500k term policy cost me per month?",
		labels: ["question"],
		noQuote: true,
	},
	{
		name: "advice request",
		inbound: "should I cancel my current policy and switch to yours?",
		labels: ["question", "needs_human"],
		noQuote: true,
	},
	{
		name: "needs a human: claim",
		inbound:
			"I need to file a claim on my husband's policy, he passed last week",
		labels: ["needs_human"],
		tool: { name: "handoff_to_human", input: {} },
		silent: true,
	},
	{
		name: "qualification facts",
		inbound: "I'm 34, live in Texas, and want term life as soon as possible",
		labels: ["interested", "qualified"],
		tool: {
			name: "record_qualification",
			input: {
				line: "term_life",
				state: "TX",
				ageBand: "30-39",
				timeline: "now",
			},
		},
	},
	{
		name: "rejection: under 18",
		inbound: "I'm 16 and want life insurance",
		labels: ["interested", "not_interested", "needs_human"],
		tool: { name: "record_qualification", input: { underAge: true } },
	},
];

export const PRICE_PATTERN = /\$\s?\d|\d+\s?(dollars|per month|\/mo)/i;

export const NO_PRICE_PATTERN = new RegExp(
	`^(?![\\s\\S]*(${PRICE_PATTERN.source}))[\\s\\S]*$`,
	"i",
);

export function labelPattern(labels: readonly SmsReplyClass[]): RegExp {
	return new RegExp(`^(${labels.join("|")})$`);
}
