const DAY_MS = 24 * 60 * 60 * 1000;

export const TODAY = {
	kpiWindowMs: 7 * DAY_MS,
	maxLeadsScanned: 5000,
	maxUnknownSends: 20,
	maxMeetings: 8,
	maxMeetingList: 50,
	maxTimelineEvents: 200,
	preview: { length: 140 },
	sentStatuses: ["SENDING", "SENT", "DELIVERED", "DELIVERY_UNCONFIRMED"],
	agentEvents: { sessionId: "sms:send", unknown: "sms.send.unknown" },
	cancelledEventStatus: "cancelled",
	interestedStages: [
		"QUALIFIED_TO_BUY",
		"DECISION_MAKER_BOUGHT_IN",
		"CONTRACT_SENT",
		"CLOSED_WON",
	],
} as const;
