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
	pausedTaskKinds: ["sms-reply", "first-touch", "sms-follow-up"],
} as const;
