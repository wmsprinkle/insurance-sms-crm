import {
	ConsentSource,
	type Db,
	type Prisma,
	SmsDirection,
	SmsStatus,
	SuppressionReason,
} from "@crm/db";
import { WORKSPACE_ID } from "@crm/db/workspace";
import { Injectable, Logger } from "@nestjs/common";
import { ConsentService } from "../compliance/consent.service";
import { SuppressionService } from "../compliance/suppression.service";
import { InjectDatabase } from "../database/database.constants";
import { keywordReply, type SmsKeyword } from "./keywords";
import { SMS } from "./sms-config";
import { SmsSender } from "./sms-sender.service";
import type { TelnyxInbound } from "./telnyx-event";
import { isUniqueViolation } from "./unique-violation";

export type KeywordOutcome = `keyword-${SmsKeyword}` | "duplicate";

export type KeywordMessage = {
	keyword: SmsKeyword;
	from: string;
	contactId: string | null;
	message: TelnyxInbound;
};

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

	private async record(
		tx: Prisma.TransactionClient,
		input: KeywordMessage,
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
				await this.suppression.suppress(
					input.from,
					SuppressionReason.STOP_KEYWORD,
					tx,
				);
				if (input.contactId) {
					await this.consent.revokeAll(input.contactId, now, tx);
					await tx.agentTask.updateMany({
						where: {
							contactId: input.contactId,
							kind: { in: [...SMS.pausedTaskKinds] },
							finishedAt: null,
						},
						data: { finishedAt: now, outcome: SMS.optedOutOutcome },
					});
				}
				return;
			case "start":
				await this.suppression.lift(input.from, LIFTED_BY_START, tx);
				if (input.contactId) {
					await this.consent.grant(
						{
							contactId: input.contactId,
							source: ConsentSource.SMS_KEYWORD,
							capturedAt: now,
							optInText: input.message.text,
						},
						tx,
					);
				}
				return;
			case "help":
				return;
		}
	}

	private async reply(input: KeywordMessage): Promise<void> {
		try {
			const workspace = await this.db.organization.findUnique({
				where: { id: WORKSPACE_ID },
				select: { name: true },
			});
			const outcome = await this.sender.send({
				to: input.from,
				contactId: input.contactId,
				text: keywordReply(input.keyword, workspace?.name ?? null),
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
