import { DealStage } from "@crm/db/enums";
import { FIRST_TOUCH_TASK_KIND } from "@crm/validation/first-touch-task";
import { SMS_REPLY_TASK_KIND } from "@crm/validation/sms-reply-task";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

export const SMS_AGENT = {
	taskKinds: {
		reply: SMS_REPLY_TASK_KIND,
		firstTouch: FIRST_TOUCH_TASK_KIND,
		followUp: "sms-follow-up",
	},
	budget: {
		windowMs: HOUR_MS,
		hourlyInbound: 12,
		depthInbound: 20,
	},
	bridge: {
		timeoutMs: 10 * SECOND_MS,
	},
	session: {
		tokenPrefix: "sms:",
		deferMs: 30 * SECOND_MS,
	},
	licensedStates: [] as readonly string[],
	booking: {
		durationMs: 30 * MINUTE_MS,
		horizonMs: 14 * 24 * HOUR_MS,
		bridgeTimeoutMs: 30 * SECOND_MS,
		summary: "Insurance call with",
		activitySource: "sms-booking",
		description:
			"Booked by the SMS assistant. A licensed agent calls the lead at this time.",
		slotFormat: {
			weekday: "short",
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
			timeZoneName: "short",
		},
	},
	deals: {
		progress: [
			DealStage.QUALIFIED_TO_BUY,
			DealStage.DEMO_BOOKED,
			DealStage.DECISION_MAKER_BOUGHT_IN,
			DealStage.CONTRACT_SENT,
		],
		createOn: new Set<DealStage>([
			DealStage.QUALIFIED_TO_BUY,
			DealStage.DEMO_BOOKED,
		]),
		nameSuffix: " — insurance",
		householdSuffix: " (household)",
		contactRole: "lead",
		lockPrefix: "sms-deal:",
		ownerProvider: "google",
	},
	messages: {
		handoff:
			"Thanks for the details. Let me get a licensed agent to follow up with you directly on this.",
		optOutConfirmation:
			"You are unsubscribed and will get no more messages. Reply START to resubscribe.",
	},
	outcomes: {
		optedOut: "opted-out",
		handedOff: "handed-off",
		replied: "replied",
		drafted: "drafted",
		blocked: "blocked",
		skipped: "skipped",
	},
	handoffReasons: {
		hourly: "hourly message limit",
		depth: "conversation depth limit",
		injection: "suspected prompt injection",
	},
} as const;
