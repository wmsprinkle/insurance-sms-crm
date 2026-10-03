import {
	ConsentSource,
	type Db,
	type Prisma,
	SmsDirection,
	SmsDraftStatus,
	SmsStatus,
	SuppressionReason,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { ConsentService } from "../compliance/consent.service";
import { SuppressionService } from "../compliance/suppression.service";
import { InjectDatabase } from "../database/database.constants";
import {
	keywordReply,
	type OptOutIntent,
	optOutConfirmationText,
	type SmsKeyword,
} from "./keywords";
import { readBrand } from "./sms-brand";
import { SMS } from "./sms-config";
import { SmsSender } from "./sms-sender.service";
import type { TelnyxInbound } from "./telnyx-event";
import { isUniqueViolation } from "./unique-violation";

export type KeywordOutcome =
	| `keyword-${SmsKeyword}`
	| `phrase-${OptOutIntent}`
	| "duplicate";

export type KeywordMessage = {
	keyword: SmsKeyword;
	from: string;
	contactId: string | null;
	message: TelnyxInbound;
};

export type OptOutMessage = {
	intent: OptOutIntent;
	from: string;
	contactId: string | null;
	message: TelnyxInbound;
};

const SUPPRESSION_BY_INTENT = {
	opt_out: SuppressionReason.OPT_OUT_REQUEST,
	wrong_number: SuppressionReason.WRONG_NUMBER,
} as const satisfies Record<OptOutIntent, SuppressionReason>;

const LIFTED_BY_START: readonly SuppressionReason[] = [
	SuppressionReason.STOP_KEYWORD,
	SuppressionReason.OPT_OUT_REQUEST,
];

@Injectable()
export class KeywordService {
	private readonly logger = new Logger(KeywordService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly consent: ConsentService,
		private readonly suppression: SuppressionService,
		private readonly sender: SmsSender,
	) {}

	async handle(input: KeywordMessage): Promise<KeywordOutcome> {
		const now = new Date();

		try {
			await this.db.$transaction(async (tx) => {
				await this.record(tx, input, now);
				await this.apply(tx, input, now);
			});
		} catch (cause) {
			if (isUniqueViolation(cause)) return "duplicate";
			throw cause;
		}

		this.logger.log({
			message: "SMS keyword handled",
			keyword: input.keyword,
			contactId: input.contactId,
		});

		await this.reply(input);

		return `keyword-${input.keyword}`;
	}

	async agentMayReply(
		tx: Prisma.TransactionClient,
		contactId: string,
		from: string,
	): Promise<boolean> {
		const [suppressed, consent] = await Promise.all([
			this.suppression.isSuppressed(from, tx),
			this.consent.hasActiveConsent({ contactId, e164: from }, tx),
		]);
		return !suppressed && consent;
	}

	async optOut(input: OptOutMessage): Promise<KeywordOutcome> {
		const now = new Date();

		try {
			await this.db.$transaction(async (tx) => {
				await this.record(tx, { ...input, keyword: input.intent }, now);
				await this.stopEverything(
					tx,
					input.from,
					input.contactId,
					SUPPRESSION_BY_INTENT[input.intent],
					now,
				);
			});
		} catch (cause) {
			if (isUniqueViolation(cause)) return "duplicate";
			throw cause;
		}

		this.logger.log({
			message: "SMS opt-out phrase handled without the agent",
			intent: input.intent,
			contactId: input.contactId,
		});

		await this.confirmOptOut(input);

		return `phrase-${input.intent}`;
	}

	private async confirmOptOut(input: OptOutMessage): Promise<void> {
		try {
			const brand = await readBrand(this.db);
			const outcome = await this.sender.send({
				to: input.from,
				contactId: input.contactId,
				text: optOutConfirmationText(
					SUPPRESSION_BY_INTENT[input.intent],
					brand,
				),
				purpose: "opt-out-confirmation",
			});
			if (outcome.status !== "sent") {
				this.logger.warn({
					message: "SMS opt-out confirmation not sent",
					intent: input.intent,
					status: outcome.status,
				});
			}
		} catch (error) {
			this.logger.error(
				{ message: "SMS opt-out confirmation failed", intent: input.intent },
				error instanceof Error ? error.stack : String(error),
			);
		}
	}

	private async stopEverything(
		tx: Prisma.TransactionClient,
		from: string,
		contactId: string | null,
		reason: SuppressionReason,
		now: Date,
	): Promise<void> {
		await this.suppression.suppress(from, reason, tx);
		await this.consent.revokeAll({ contactId, e164: from }, now, tx);
		if (!contactId) return;

		await tx.agentTask.updateMany({
			where: {
				contactId,
				kind: { in: [...SMS.pausedTaskKinds] },
				finishedAt: null,
			},
			data: { finishedAt: now, outcome: SMS.optedOutOutcome },
		});
		await tx.smsDraft.updateMany({
			where: { contactId, status: SmsDraftStatus.PENDING },
			data: { status: SmsDraftStatus.DISCARDED, decidedAt: now },
		});
		await tx.smsMessage.updateMany({
			where: {
				contactId,
				direction: SmsDirection.INBOUND,
				handledAt: null,
			},
			data: { handledAt: now },
		});
	}

	private async record(
		tx: Prisma.TransactionClient,
		input: Omit<KeywordMessage, "keyword"> & {
			keyword: SmsKeyword | OptOutIntent;
		},
		now: Date,
	): Promise<void> {
		if (input.contactId) {
			await tx.smsMessage.create({
				data: {
					contactId: input.contactId,
					direction: SmsDirection.INBOUND,
					body: input.message.text,
					telnyxId: input.message.telnyxId,
					status: SmsStatus.RECEIVED,
				},
			});
			return;
		}

		const { sessionId, type, idPrefix } = SMS.keywordReceipt;
		await tx.agentEvent.create({
			data: {
				id: `${idPrefix}${input.message.telnyxId}`,
				sessionId,
				contactId: null,
				type,
				data: {
					from: input.from,
					keyword: input.keyword,
					telnyxId: input.message.telnyxId,
				},
				emittedAt: now,
			},
		});
	}

	private async apply(
		tx: Prisma.TransactionClient,
		input: KeywordMessage,
		now: Date,
	): Promise<void> {
		switch (input.keyword) {
			case "stop":
				await this.stopEverything(
					tx,
					input.from,
					input.contactId,
					SuppressionReason.STOP_KEYWORD,
					now,
				);
				return;
			case "start":
				await this.start(tx, input, now);
				return;
			case "help":
				return;
		}
	}

	private async start(
		tx: Prisma.TransactionClient,
		input: KeywordMessage,
		now: Date,
	): Promise<void> {
		const lifted = await this.suppression.lift(input.from, LIFTED_BY_START, tx);
		if (!input.contactId) return;

		const [owner, prior] = await Promise.all([
			tx.contact.findFirst({
				where: { id: input.contactId, phone: input.from, archivedAt: null },
				select: { id: true },
			}),
			tx.consentRecord.findFirst({
				where: { contactId: input.contactId, e164: input.from },
				select: { id: true },
			}),
		]);
		if (!owner || (!lifted && !prior)) {
			this.logger.warn({
				message: "START did not grant consent: no earlier consent or opt-out",
				contactId: input.contactId,
			});
			return;
		}

		await this.consent.grant(
			{
				contactId: input.contactId,
				e164: input.from,
				source: ConsentSource.SMS_KEYWORD,
				capturedAt: now,
				optInText: input.message.text,
			},
			tx,
		);
	}

	private async reply(input: KeywordMessage): Promise<void> {
		try {
			const brand = await readBrand(this.db);
			const outcome = await this.sender.send({
				to: input.from,
				contactId: input.contactId,
				text: keywordReply(input.keyword, brand),
				purpose: "keyword-reply",
			});
			if (outcome.status !== "sent") {
				this.logger.warn({
					message: "SMS keyword reply not sent",
					keyword: input.keyword,
					status: outcome.status,
				});
			}
		} catch (error) {
			this.logger.error(
				{ message: "SMS keyword reply failed", keyword: input.keyword },
				error instanceof Error ? error.stack : String(error),
			);
		}
	}
}
