export const SMS_DRAFTS = {
	list: { maxDrafts: 200, maxHandoffs: 200 },
	idempotency: { draftPrefix: "sms-draft:", composePrefix: "sms-compose:" },
	handBack: {
		reason: "Handed back to the agent",
		maxMessages: 20,
	},
	errors: {
		noPhone: "This contact has no phone number on an active record.",
		gone: "This draft is no longer pending.",
	},
} as const;
