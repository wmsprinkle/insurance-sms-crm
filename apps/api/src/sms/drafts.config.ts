export const SMS_DRAFTS = {
	list: { maxDrafts: 200, maxHandoffs: 200 },
	bulk: { maxDrafts: 200 },
	idempotency: { draftPrefix: "sms-draft:", composePrefix: "sms-compose:" },
	handBack: {
		reason: "Handed back to the agent",
		maxMessages: 20,
	},
	uncertainReasons: ["no-send-path", "send-failed"],
	verifiedPurposes: ["conversation", "first-touch"],
	errors: {
		noPhone: "This contact has no phone number on an active record.",
		gone: "This draft is no longer pending.",
		alreadySent:
			"The agent already sent this text, so the draft was discarded.",
		unknownOutcome:
			"The send outcome is unknown. Check Telnyx. If the text did not arrive, discard this draft and send a new text.",
		inProgress:
			"The agent's send of this text is still in progress. Try again in a few minutes.",
	},
} as const;
