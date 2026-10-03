import type { Db } from "@crm/db";
import {
	type SmsSendRequest,
	type SmsSendResponse,
	smsSendResponse,
} from "@crm/validation/sms-send";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import { gatePurpose, SMS_INTERNAL, sendResponse } from "./sms-internal";
import { SmsSender } from "./sms-sender.service";
import { isUniqueViolation } from "./unique-violation";

export const SMS_DRY_RUN_SENDER = Symbol("SMS_DRY_RUN_SENDER");

const sentReceipt = z.object({ response: smsSendResponse });

const { idempotency, errors } = SMS_INTERNAL;

@Injectable()
export class SmsInternalService {
	private readonly logger = new Logger(SmsInternalService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(SmsSender) private readonly live: SmsSender,
		@Inject(SMS_DRY_RUN_SENDER) private readonly dry: SmsSender,
	) {}

	async send(request: SmsSendRequest): Promise<SmsSendResponse> {
		const recipientError = await this.recipientError(request);
		if (recipientError) return { status: "failed", error: recipientError };

		const receiptId = `${idempotency.idPrefix}${request.idempotencyKey}`;
		if (!(await this.claim(receiptId, request))) {
			return this.replay(receiptId);
		}

		let response: SmsSendResponse;
		try {
			const sender = request.dryRun ? this.dry : this.live;
			response = sendResponse(
				await sender.send({
					to: request.to,
					contactId: request.contactId,
					text: request.text,
					purpose: gatePurpose(request.purpose),
				}),
			);
		} catch (cause) {
			await this.settle(receiptId, request, idempotency.released, null);
			throw cause;
		}

		await this.settle(
			receiptId,
			request,
			response.status === "sent" ? idempotency.sent : idempotency.released,
			response,
		);
		return response;
	}

	private async recipientError(
		request: SmsSendRequest,
	): Promise<string | null> {
		const contact = await this.db.contact.findFirst({
			where: { id: request.contactId, archivedAt: null },
			select: { phone: true },
		});
		if (!contact) return errors.unknownContact;
		if (contact.phone !== request.to) return errors.wrongNumber;
		return null;
	}

	private async claim(
		receiptId: string,
		request: SmsSendRequest,
	): Promise<boolean> {
		const now = new Date();
		try {
			await this.db.agentEvent.create({
				data: {
					id: receiptId,
					sessionId: idempotency.sessionId,
					contactId: request.contactId,
					type: idempotency.claimed,
					data: { purpose: request.purpose, taskId: request.taskId },
					emittedAt: now,
				},
			});
			return true;
		} catch (cause) {
			if (!isUniqueViolation(cause)) throw cause;
		}

		const reclaimed = await this.db.agentEvent.updateMany({
			where: { id: receiptId, type: idempotency.released },
			data: { type: idempotency.claimed, emittedAt: now },
		});
		return reclaimed.count === 1;
	}

	private async replay(receiptId: string): Promise<SmsSendResponse> {
		const receipt = await this.db.agentEvent.findUnique({
			where: { id: receiptId },
		});
		if (receipt?.type !== idempotency.sent) {
			return { status: "failed", error: errors.inProgress };
		}

		const parsed = sentReceipt.safeParse(receipt.data);
		if (!parsed.success) {
			throw new Error(
				`Unreadable sms send receipt ${receiptId}: ${parsed.error.message}`,
			);
		}
		this.logger.log({
			message: "Replayed an SMS send for a repeated idempotency key",
			receiptId,
		});
		return parsed.data.response;
	}

	private async settle(
		receiptId: string,
		request: SmsSendRequest,
		type: string,
		response: SmsSendResponse | null,
	): Promise<void> {
		await this.db.agentEvent.update({
			where: { id: receiptId },
			data: {
				type,
				data: { purpose: request.purpose, taskId: request.taskId, response },
				emittedAt: new Date(),
			},
		});
	}
}
