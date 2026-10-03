import { randomUUID } from "node:crypto";
import { type Db, FieldEntity, SmsDirection, SmsStatus } from "@crm/db";
import { fieldKeyFromLabel } from "@crm/db/fields-shape";
import { QUALIFICATION_FIELD_LABELS } from "@crm/validation/sms-qualification";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { isUniqueViolation } from "../sms/unique-violation";
import { COMPLIANCE } from "./compliance-config";
import { ConsentService } from "./consent.service";
import {
	isWithinSendWindow,
	nextSendWindow,
	type SendWindow,
	sendWindowFor,
} from "./quiet-hours";
import { SuppressionService } from "./suppression.service";

export type SendPurpose =
	| "conversation"
	| "keyword-reply"
	| "opt-out-confirmation";

export type GateFacts = {
	purpose: SendPurpose;
	supportedNumber: boolean;
	consent: boolean;
	suppressed: boolean;
	optOutConfirmable: boolean;
	withinHours: boolean;
	nextWindowAt: Date | null;
	frequencyRetryAt: Date | null;
};

export type BlockReason =
	| "suppressed"
	| "no-consent"
	| "quiet-hours"
	| "frequency-cap"
	| "unsupported-number"
	| "no-opt-out-to-confirm";

export type GateDecision =
	| {
			allowed: true;
			reason: "consented" | "keyword-reply" | "opt-out-confirmation";
	  }
	| { allowed: false; reason: BlockReason; retryAt: Date | null };

export type GateRequest = {
	to: string;
	contactId: string | null;
	purpose: SendPurpose;
	state?: string | null;
	now?: Date;
};

const NO_FREQUENCY_LIMIT = null;

export function decide(facts: GateFacts): GateDecision {
	if (facts.purpose === "keyword-reply") {
		return { allowed: true, reason: "keyword-reply" };
	}
	if (facts.purpose === "opt-out-confirmation") {
		return facts.optOutConfirmable
			? { allowed: true, reason: "opt-out-confirmation" }
			: { allowed: false, reason: "no-opt-out-to-confirm", retryAt: null };
	}
	if (!facts.supportedNumber) {
		return { allowed: false, reason: "unsupported-number", retryAt: null };
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
	if (facts.frequencyRetryAt) {
		return {
			allowed: false,
			reason: "frequency-cap",
			retryAt: facts.frequencyRetryAt,
		};
	}
	return { allowed: true, reason: "consented" };
}

export function frequencyRetryAt(
	sentAt: readonly Date[],
	lastInboundAt: Date | null,
	now: Date,
): Date | null {
	const since = lastInboundAt?.getTime() ?? Number.NEGATIVE_INFINITY;
	const caps = [COMPLIANCE.frequency.day, COMPLIANCE.frequency.week];
	let retryAt: number | null = NO_FREQUENCY_LIMIT;

	for (const cap of caps) {
		const start = Math.max(now.getTime() - cap.windowMs, since);
		const counted = sentAt
			.map((at) => at.getTime())
			.filter((at) => at > start)
			.sort((a, b) => a - b);
		if (counted.length < cap.max) continue;

		const oldestThatMatters = counted[counted.length - cap.max];
		if (oldestThatMatters === undefined) continue;
		const freesAt = oldestThatMatters + cap.windowMs;
		retryAt = retryAt === null ? freesAt : Math.max(retryAt, freesAt);
	}

	return retryAt === null ? null : new Date(retryAt);
}

function optOutConfirmable(suppressedAt: Date, now: Date): boolean {
	const age = now.getTime() - suppressedAt.getTime();
	return age >= 0 && age <= COMPLIANCE.optOutConfirmation.windowMs;
}

export function optOutConfirmationKey(
	e164: string,
	suppressedAt: Date,
): string {
	return `${COMPLIANCE.optOutConfirmation.claimPrefix}${e164}:${suppressedAt.getTime()}`;
}

const STATE_FIELD_KEY = fieldKeyFromLabel(QUALIFICATION_FIELD_LABELS.state);

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
		const state =
			request.state === undefined
				? await this.declaredState(request.contactId)
				: request.state;
		const window = sendWindowFor({ e164: request.to, state });

		const [consent, suppression, frequency] = await Promise.all([
			request.contactId
				? this.consent.hasActiveConsent({
						contactId: request.contactId,
						e164: request.to,
					})
				: Promise.resolve(false),
			this.suppression.find(request.to),
			request.purpose === "conversation" && request.contactId
				? this.frequency(request.contactId, now)
				: Promise.resolve(null),
		]);
		const withinHours = isWithinSendWindow(now, window);
		const confirmable =
			request.purpose === "opt-out-confirmation" &&
			suppression !== null &&
			optOutConfirmable(suppression.createdAt, now) &&
			(await this.claimOptOutConfirmation(request, suppression.createdAt, now));

		const decision = decide({
			purpose: request.purpose,
			supportedNumber: request.to.startsWith(COMPLIANCE.supportedCountryPrefix),
			consent,
			suppressed: suppression !== null,
			optOutConfirmable: confirmable,
			withinHours,
			nextWindowAt: withinHours ? now : nextSendWindow(now, window),
			frequencyRetryAt: frequency,
		});

		await this.audit(request, window, decision, now);

		return decision;
	}

	private async declaredState(
		contactId: string | null,
	): Promise<string | null> {
		if (!contactId) return null;
		const value = await this.db.fieldValue.findFirst({
			where: {
				contactId,
				field: {
					key: STATE_FIELD_KEY,
					entity: FieldEntity.CONTACT,
					archivedAt: null,
				},
			},
			select: { text: true },
		});
		return value?.text ?? null;
	}

	private async frequency(contactId: string, now: Date): Promise<Date | null> {
		const { week } = COMPLIANCE.frequency;
		const [sent, lastInbound] = await Promise.all([
			this.db.smsMessage.findMany({
				where: {
					contactId,
					direction: SmsDirection.OUTBOUND,
					status: { not: SmsStatus.SENDING_FAILED },
					createdAt: { gt: new Date(now.getTime() - week.windowMs) },
				},
				orderBy: { createdAt: "desc" },
				take: week.max,
				select: { createdAt: true },
			}),
			this.db.smsMessage.findFirst({
				where: { contactId, direction: SmsDirection.INBOUND },
				orderBy: { createdAt: "desc" },
				select: { createdAt: true },
			}),
		]);
		return frequencyRetryAt(
			sent.map((row) => row.createdAt),
			lastInbound?.createdAt ?? null,
			now,
		);
	}

	private async claimOptOutConfirmation(
		request: GateRequest,
		suppressedAt: Date,
		now: Date,
	): Promise<boolean> {
		const { claimSessionId, claimType } = COMPLIANCE.optOutConfirmation;
		try {
			await this.db.agentEvent.create({
				data: {
					id: optOutConfirmationKey(request.to, suppressedAt),
					sessionId: claimSessionId,
					contactId: request.contactId,
					type: claimType,
					data: { to: request.to, suppressedAt: suppressedAt.toISOString() },
					emittedAt: now,
				},
			});
			return true;
		} catch (cause) {
			if (isUniqueViolation(cause)) return false;
			throw cause;
		}
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
