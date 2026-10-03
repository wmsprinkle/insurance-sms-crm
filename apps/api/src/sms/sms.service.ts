import { type Db, Prisma, SmsDirection, SmsStatus } from "@crm/db";
import { lockIdempotencyKey } from "@crm/db/idempotency";
import { toE164 } from "@crm/validation/phone";
import {
	type SmsReplyTaskPayload,
	smsReplyTaskPayload,
} from "@crm/validation/sms-reply-task";
import { Injectable, Logger } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { InjectDatabase } from "../database/database.constants";
import { SMS } from "./sms-config";
import {
	statusesBelow,
	type TelnyxInbound,
	type TelnyxStatusUpdate,
} from "./telnyx-event";

export type InboundOutcome =
	| "stored"
	| "duplicate"
	| "unknown-sender"
	| "invalid-sender";

export type StatusOutcome = "updated" | "unchanged";

export function isUniqueViolation(cause: unknown): boolean {
	return (
		cause instanceof Prisma.PrismaClientKnownRequestError &&
		cause.code === "P2002"
	);
}

@Injectable()
export class SmsService {
	private readonly logger = new Logger(SmsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly agents: AgentTriggerService,
	) {}

	async receive(message: TelnyxInbound): Promise<InboundOutcome> {
		const from = toE164(message.from);
		if (!from) {
			this.logger.warn({
				message: "Inbound SMS sender is not a phone number",
				telnyxId: message.telnyxId,
			});
			return "invalid-sender";
		}

		const contact = await this.contactFor(from);
		if (!contact) {
			this.logger.warn({
				message: "Inbound SMS from a number no contact has",
				telnyxId: message.telnyxId,
			});
			return "unknown-sender";
		}

		try {
			await this.db.$transaction(async (tx) => {
				const sms = await tx.smsMessage.create({
					data: {
						contactId: contact.id,
						direction: SmsDirection.INBOUND,
						body: message.text,
						telnyxId: message.telnyxId,
						status: SmsStatus.RECEIVED,
					},
					select: { id: true },
				});
				await this.queueReply(tx, contact.id, sms.id, from);
			});
		} catch (cause) {
			if (isUniqueViolation(cause)) return "duplicate";
			throw cause;
		}

		this.logger.log({
			message: "Inbound SMS stored",
			contactId: contact.id,
			telnyxId: message.telnyxId,
		});
		this.agents.drainQueues();

		return "stored";
	}

	async updateStatus(update: TelnyxStatusUpdate): Promise<StatusOutcome> {
		const { count } = await this.db.smsMessage.updateMany({
			where: {
				telnyxId: update.telnyxId,
				status: { in: statusesBelow(update.status) },
			},
			data: { status: update.status, errorCode: update.errorCode },
		});

		return count > 0 ? "updated" : "unchanged";
	}

	contactFor(e164: string): Promise<{ id: string } | null> {
		return this.db.contact.findFirst({
			where: { phone: e164, archivedAt: null },
			select: { id: true },
		});
	}

	private async queueReply(
		tx: Prisma.TransactionClient,
		contactId: string,
		smsMessageId: string,
		from: string,
	): Promise<void> {
		const { kind, priority, budget } = SMS.replyTask;
		await lockIdempotencyKey(tx, `agent-task:${kind}:${contactId}`);

		const pending = await tx.agentTask.findFirst({
			where: { kind, contactId, finishedAt: null, startedAt: null },
			select: { id: true, payload: true },
		});

		if (pending) {
			const prior = smsReplyTaskPayload.safeParse(pending.payload);
			if (prior.success) {
				const payload: SmsReplyTaskPayload = {
					...prior.data,
					smsMessageIds: [...prior.data.smsMessageIds, smsMessageId],
				};
				await tx.agentTask.update({
					where: { id: pending.id },
					data: { payload },
				});
				return;
			}

			this.logger.error({
				message: "Pending sms-reply task has an unreadable payload",
				taskId: pending.id,
				issues: prior.error.issues.length,
			});
		}

		const payload: SmsReplyTaskPayload = {
			type: "sms.received",
			smsMessageIds: [smsMessageId],
			from,
		};
		await tx.agentTask.create({
			data: {
				contactId,
				kind,
				reason: "Inbound SMS",
				priority,
				budget,
				dueAt: new Date(),
				payload,
			},
		});
	}
}
