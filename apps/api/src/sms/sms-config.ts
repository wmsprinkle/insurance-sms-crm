const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;

export const SMS = {
	telnyx: {
		messagesUrl: "https://api.telnyx.com/v2/messages",
		timeoutMs: 10 * SECOND_MS,
		dryRunIdPrefix: "dryrun-",
	},
	rate: {
		defaultMessagesPerSecond: 1,
		burst: 1,
	},
	webhook: {
		replayWindowMs: 5 * MINUTE_MS,
		maxBodyBytes: 256 * 1024,
	},
	replyTask: {
		kind: "sms-reply",
		priority: 90,
		budget: 4,
	},
	threads: {
		previewLength: 160,
		maxMessages: 200,
	},
	pausedTaskKinds: ["sms-reply", "first-touch", "sms-follow-up"],
	keywords: {
		stop: [
			"STOP",
			"STOPALL",
			"STOP ALL",
			"UNSUBSCRIBE",
			"CANCEL",
			"END",
			"QUIT",
			"OPTOUT",
			"OPT-OUT",
			"OPT OUT",
			"REVOKE",
		],
		start: ["START", "UNSTOP"],
		help: ["HELP", "INFO"],
	},
	keywordReplies: {
		brandFallback: "Our team",
		stop: "{brand}: You are unsubscribed and will get no more messages. Reply START to resubscribe.",
		start:
			"{brand}: You are resubscribed. Msg & data rates may apply. Reply HELP for help, STOP to unsubscribe.",
		help: "{brand}: Reply to this message and a licensed agent will follow up. Msg & data rates may apply. Reply STOP to unsubscribe.",
		optOut:
			"{brand}: You are unsubscribed and will get no more messages. Reply START to resubscribe.",
		wrongNumber:
			"{brand}: Sorry for the mix-up. This number is removed and will get no more messages.",
	},
	optOutPhrases: {
		opt_out: [
			"don't text",
			"dont text",
			"do not text",
			"don't message",
			"dont message",
			"do not message",
			"don't contact",
			"dont contact",
			"do not contact",
			"stop texting",
			"stop messaging",
			"stop sending",
			"stop contacting",
			"quit texting",
			"no more texts",
			"no more messages",
			"remove me",
			"remove my number",
			"take me off",
			"take my number off",
			"unsubscribe",
			"opt me out",
			"opt out",
			"leave me alone",
			"lose my number",
			"delete my number",
		],
		wrong_number: [
			"wrong number",
			"you have the wrong",
			"you've got the wrong",
			"youve got the wrong",
			"nobody by that name",
			"no one by that name",
			"no one here by that name",
		],
		leadingStopWords: ["STOP", "STOPALL", "UNSUBSCRIBE", "OPTOUT"],
	},
	optOutOutcome: {
		received: "sms.opt-out.received",
	},
	optedOutOutcome: "opted-out",
	keywordReceipt: {
		sessionId: "sms:keyword",
		type: "sms.keyword.received",
		idPrefix: "sms-keyword:",
	},
} as const;
