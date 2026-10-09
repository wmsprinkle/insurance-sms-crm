import { createHash } from "node:crypto";
import { type Db, SmsDirection } from "@crm/db";
import {
	type SmsSendRequest,
	type SmsSendResponse,
	smsSendResponse,
} from "@crm/validation/sms-send";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { optOutConfirmationKey } from "../compliance/send-gate";
import { InjectDatabase } from "../database/database.constants";
import { optOutConfirmationText } from "./keywords";
import { readBrand } from "./sms-brand";
import { gatePurpose, SMS_INTERNAL, sendResponse } from "./sms-internal";
import { SendOutcomeUnknownError, SmsSender } from "./sms-sender.service";
import { isUniqueViolation } from "./unique-violation";

const sentReceipt = z.object({
	response: smsSendResponse,
	contactId: z.string().optional(),
	textHash: z.string().optional(),
});

function textHash(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function receiptPayload(request: SmsSendRequest) {
	return {
		purpose: request.purpose,
		taskId: request.taskId,
		contactId: request.contactId,
		textHash: textHash(request.text),
	};
}

const { idempotency, errors } = SMS_INTERNAL;

@Injectable()
export class SmsInternalService {
	private readonly logger = new Logger(SmsInternalService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(SmsSender) private readonly sender: SmsSender,
	) {}

	async send(original: SmsSendRequest): Promise<SmsSendResponse> {
		const recipientError = await this.recipientError(original);
		if (recipientError) return { status: "failed", error: recipientError };

		const request =
			original.purpose === "opt-out-confirmation"
				? await this.optOutConfirmation(original)
				: original;
		if (!request) return { status: "failed", error: errors.noOptOut };

		const receiptId = `${idempotency.idPrefix}${request.idempotencyKey}`;
		if (!(await this.claim(receiptId, request))) {
			return this.replay(receiptId, request);
		}

		let response: SmsSendResponse;
		try {
			response = sendResponse(
				await this.sender.send({
					to: request.to,
					contactId: request.contactId,
					text: request.text,
					purpose: gatePurpose(request.purpose),
					receiptId,
				}),
			);
		} catch (cause) {
			const unknown = cause instanceof SendOutcomeUnknownError;
			await this.settle(
				receiptId,
				request,
				unknown ? idempotency.unknown : idempotency.released,
				null,
			);
			if (unknown) {
				this.logger.error({
					message: "SMS send outcome unknown: the receipt stays blocked",
					receiptId,
					contactId: request.contactId,
				});
			}
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

	private async optOutConfirmation(
		request: SmsSendRequest,
	): Promise<SmsSendRequest | null> {
		const [suppression, brand] = await Promise.all([
			this.db.phoneSuppression.findUnique({
				where: { e164: request.to },
				select: { reason: true, createdAt: true },
			}),
			readBrand(this.db),
		]);
		if (!suppression) return null;

		return {
			...request,
			text: optOutConfirmationText(suppression.reason, brand),
			idempotencyKey: optOutConfirmationKey(request.to, suppression.createdAt),
		};
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
					data: receiptPayload(request),
					emittedAt: now,
				},
			});
			return true;
		} catch (cause) {
			if (!isUniqueViolation(cause)) throw cause;
		}

		const reclaimed = await this.db.agentEvent.updateMany({
			where: { id: receiptId, type: idempotency.released },
			data: {
				type: idempotency.claimed,
				emittedAt: now,
				data: receiptPayload(request),
			},
		});
		if (reclaimed.count === 1) return true;

		return this.reclaimStale(receiptId, request, now);
	}

	private async reclaimStale(
		receiptId: string,
		request: SmsSendRequest,
		now: Date,
	): Promise<boolean> {
		const staleBefore = new Date(now.getTime() - SMS_INTERNAL.lease.claimMs);
		const receipt = await this.db.agentEvent.findUnique({
			where: { id: receiptId },
			select: { type: true, emittedAt: true },
		});
		if (receipt?.type !== idempotency.claimed) return false;
		if (receipt.emittedAt > staleBefore) return false;

		const written = await this.db.smsMessage.findFirst({
			where: {
				contactId: request.contactId,
				direction: SmsDirection.OUTBOUND,
				body: request.text,
				createdAt: { gte: receipt.emittedAt },
			},
			select: { id: true },
		});
		if (written) return false;

		const reclaimed = await this.db.agentEvent.updateMany({
			where: {
				id: receiptId,
				type: idempotency.claimed,
				emittedAt: receipt.emittedAt,
			},
			data: { emittedAt: now },
		});
		if (reclaimed.count === 1) {
			this.logger.warn({
				message: "Reclaimed a stale SMS send claim",
				receiptId,
			});
		}
		return reclaimed.count === 1;
	}

	private async replay(
		receiptId: string,
		request: SmsSendRequest,
	): Promise<SmsSendResponse> {
		const receipt = await this.db.agentEvent.findUnique({
			where: { id: receiptId },
		});
		if (receipt?.type === idempotency.unknown) {
			return { status: "failed", error: errors.unknownOutcome };
		}
		if (receipt?.type !== idempotency.sent) {
			return { status: "failed", error: errors.inProgress };
		}

		const parsed = sentReceipt.safeParse(receipt.data);
		if (!parsed.success) {
			throw new Error(
				`Unreadable sms send receipt ${receiptId}: ${parsed.error.message}`,
			);
		}
		const { contactId, textHash: sentHash } = parsed.data;
		if (
			(contactId !== undefined && contactId !== request.contactId) ||
			(sentHash !== undefined && sentHash !== textHash(request.text))
		) {
			this.logger.warn({
				message: "Refused an idempotency key reused for a different SMS",
				receiptId,
			});
			return { status: "failed", error: errors.keyReused };
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
				data: { ...receiptPayload(request), response },
				emittedAt: new Date(),
			},
		});
	}
}
