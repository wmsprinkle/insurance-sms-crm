import { smsTurnMessage } from "../../agent/lib/sms-pipeline";
import type { SmsLine } from "../../agent/lib/sms-store";

export type BookingCase = {
	name: string;
	history: readonly [direction: SmsLine["direction"], body: string][];
	inbound: string;
	tool: string;
	input?: { [key: string]: RegExp | boolean };
	notTool?: string;
};

const AT = new Date("2026-10-05T14:00:00.000Z");

const QUALIFIED: BookingCase["history"] = [
	[
		"OUTBOUND",
		"Hi Dana, this is Acme Insurance. You asked us about an insurance quote, so we are following up here. Reply with any questions. Reply STOP to opt out.",
	],
	["INBOUND", "I'm 34, live in Texas, and want term life as soon as possible"],
];

const OFFERED: BookingCase["history"] = [
	...QUALIFIED,
	[
		"OUTBOUND",
		"Thanks Dana. A licensed agent can go over options on a short call. Does Tue, Oct 6 at 10:00 AM CDT or Tue, Oct 6 at 11:00 AM CDT work?",
	],
];

const PICKED: BookingCase["history"] = [
	...OFFERED,
	["INBOUND", "10 works"],
	["OUTBOUND", "Great. What email should the calendar invite go to?"],
];

export function bookingMessage(row: BookingCase): string {
	return smsTurnMessage({
		inbound: [row.inbound],
		history: row.history.map(([direction, body]) => ({
			direction,
			body,
			createdAt: AT,
		})),
		disclosure: "disclose",
		bookingLink: null,
	});
}

export const BOOKING_CASES: readonly BookingCase[] = [
	{
		name: "qualified lead asks for a call",
		history: QUALIFIED,
		inbound: "yes I'd like to talk to someone, when can we do it?",
		tool: "propose_slots",
		notTool: "book_meeting",
	},
	{
		name: "lead picks an offered time",
		history: OFFERED,
		inbound: "the 10am one works for me",
		tool: "book_meeting",
	},
	{
		name: "lead gives the email for the invite",
		history: PICKED,
		inbound: "sure, it's dana.reyes@example.com",
		tool: "book_meeting",
		input: { email: /dana\.reyes@example\.com/i },
	},
	{
		name: "lead refuses to give an email",
		history: PICKED,
		inbound: "I'd rather not give out my email, just call me",
		tool: "book_meeting",
		input: { emailDeclined: true },
	},
];
