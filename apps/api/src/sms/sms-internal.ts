import { timingSafeEqual } from "node:crypto";
import {
	SMS_BLOCK_REASONS,
	type SmsSendPurpose,
	type SmsSendResponse,
} from "@crm/validation/sms-send";
import type { BlockReason, SendPurpose } from "../compliance/send-gate";
import type { SendOutcome } from "./sms-sender.service";

const KILOBYTE = 1024;
const MINUTE_MS = 60_000;

export const SMS_INTERNAL = {
	body: { maxBytes: 16 * KILOBYTE },
	idempotency: {
		idPrefix: "sms-send:",
		sessionId: "sms:send",
		claimed: "sms.send.claimed",
		sent: "sms.send.sent",
		released: "sms.send.released",
	},
	errors: {
		unknownContact: "The contact does not exist or is archived.",
		wrongNumber: "The number does not belong to the contact.",
		inProgress: "A send with this idempotency key is in progress.",
		noOptOut: "The number has no opt-out to confirm.",
		keyReused:
			"This idempotency key already sent a different message or went to another contact.",
	},
	blockedAsFailed: {
		"frequency-cap":
			"The lead already got the most texts allowed in this period.",
		"unsupported-number": "Only US (+1) numbers can be texted.",
	},
	blockedAs: { "no-opt-out-to-confirm": "suppressed" },
	lease: { claimMs: 5 * MINUTE_MS },
} as const;

const BEARER = "Bearer ";

export function bridgeAuthorised(
	header: string | undefined,
	secret: string,
): boolean {
	if (!header?.startsWith(BEARER)) return false;
	const candidate = Buffer.from(header.slice(BEARER.length));
	const expected = Buffer.from(secret);
	if (candidate.length !== expected.length) return false;

	return timingSafeEqual(candidate, expected);
}

export function gatePurpose(purpose: SmsSendPurpose): SendPurpose {
	return purpose === "opt-out-confirmation"
		? "opt-out-confirmation"
		: "conversation";
}

type ContractBlockReason = (typeof SMS_BLOCK_REASONS)[number];

function isContractBlockReason(
	reason: BlockReason,
): reason is ContractBlockReason {
	return (SMS_BLOCK_REASONS as readonly string[]).includes(reason);
}

export function sendResponse(outcome: SendOutcome): SmsSendResponse {
	if (outcome.status === "sent") {
		return {
			status: "sent",
			telnyxId: outcome.telnyxId,
			dryRun: outcome.dryRun,
		};
	}
	if (outcome.status === "failed") {
		return { status: "failed", error: outcome.error };
	}
	if (outcome.decision.allowed) {
		throw new Error("A blocked send carries an allowed gate decision.");
	}
	const { reason, retryAt } = outcome.decision;
	if (reason === "no-opt-out-to-confirm") {
		return {
			status: "blocked",
			reason: SMS_INTERNAL.blockedAs[reason],
			retryAt: null,
		};
	}
	if (!isContractBlockReason(reason)) {
		return { status: "failed", error: SMS_INTERNAL.blockedAsFailed[reason] };
	}
	return {
		status: "blocked",
		reason,
		retryAt: retryAt?.toISOString() ?? null,
	};
}
