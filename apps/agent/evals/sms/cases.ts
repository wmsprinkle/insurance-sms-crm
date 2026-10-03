import type { SmsReplyClass } from "@crm/validation/sms-qualification";
import { smsTurnMessage } from "../../agent/lib/sms-pipeline";

export type SmsCase = {
	name: string;
	inbound: string;
	labels: readonly SmsReplyClass[];
	tool?: { name: string; input: { [key: string]: string | boolean } };
	silent?: boolean;
	noQuote?: boolean;
};

const FIRST_TOUCH =
	"Hi Dana, this is Acme Insurance. You asked us about an insurance quote, so we are following up here. Reply with any questions. Reply STOP to opt out.";

export function caseMessage(inbound: string): string {
	return smsTurnMessage({
		inbound: [inbound],
		history: [
			{
				direction: "OUTBOUND",
				body: FIRST_TOUCH,
				createdAt: new Date("2026-10-03T14:00:00.000Z"),
			},
		],
		disclosure: "disclose",
		bookingLink: null,
	});
}

export const SMS_CASES: readonly SmsCase[] = [
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
