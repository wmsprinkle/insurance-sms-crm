import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { COMPLIANCE } from "./compliance-config";
import { ConsentService } from "./consent.service";
import {
	isWithinSendWindow,
	nextSendWindow,
	type SendWindow,
	sendWindowFor,
} from "./quiet-hours";
import { SuppressionService } from "./suppression.service";

export type SendPurpose = "conversation" | "keyword-reply";

export type GateFacts = {
	purpose: SendPurpose;
	consent: boolean;
	suppressed: boolean;
	withinHours: boolean;
	nextWindowAt: Date | null;
};

export type BlockReason = "suppressed" | "no-consent" | "quiet-hours";

export type GateDecision =
	| { allowed: true; reason: "consented" | "keyword-reply" }
	| { allowed: false; reason: BlockReason; retryAt: Date | null };

export type GateRequest = {
	to: string;
	contactId: string | null;
	purpose: SendPurpose;
	state?: string | null;
	now?: Date;
};

export function decide(facts: GateFacts): GateDecision {
	if (facts.purpose === "keyword-reply") {
		return { allowed: true, reason: "keyword-reply" };
	}
	if (facts.suppressed) {
		return { allowed: false, reason: "suppressed", retryAt: null };
	}
	if (!facts.consent) {
		return { allowed: false, reason: "no-consent", retryAt: null };
	}
	if (!facts.withinHours) {
		return {
			allowed: false,
			reason: "quiet-hours",
			retryAt: facts.nextWindowAt,
		};
	}
	return { allowed: true, reason: "consented" };
}

@Injectable()
export class SendGateService {
	private readonly logger = new Logger(SendGateService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly consent: ConsentService,
		private readonly suppression: SuppressionService,
	) {}

	async check(request: GateRequest): Promise<GateDecision> {
		const now = request.now ?? new Date();
		const window = sendWindowFor({ e164: request.to, state: request.state });

		const [consent, suppressed] = await Promise.all([
			request.contactId
				? this.consent.hasActiveConsent(request.contactId)
				: Promise.resolve(false),
			this.suppression.isSuppressed(request.to),
		]);
		const withinHours = isWithinSendWindow(now, window);

		const decision = decide({
			purpose: request.purpose,
			consent,
			suppressed,
			withinHours,
			nextWindowAt: withinHours ? now : nextSendWindow(now, window),
		});

		await this.audit(request, window, decision, now);

		return decision;
	}

	private async audit(
		request: GateRequest,
		window: SendWindow,
		decision: GateDecision,
		now: Date,
	): Promise<void> {
		const { sessionId, allowed, blocked } = COMPLIANCE.audit;

		await this.db.agentEvent.create({
			data: {
				id: randomUUID(),
				sessionId,
				contactId: request.contactId,
				type: decision.allowed ? allowed : blocked,
				data: {
					to: request.to,
					purpose: request.purpose,
					reason: decision.reason,
					retryAt:
						!decision.allowed && decision.retryAt
							? decision.retryAt.toISOString()
							: null,
					state: window.state,
					timezones: [...window.timezones],
				},
				emittedAt: now,
			},
		});

		this.logger.log({
			message: decision.allowed ? "SMS send allowed" : "SMS send blocked",
			contactId: request.contactId,
			purpose: request.purpose,
			reason: decision.reason,
		});
	}
}
