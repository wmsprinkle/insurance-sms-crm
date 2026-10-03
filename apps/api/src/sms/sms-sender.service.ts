import { type Db, SmsDirection, SmsStatus } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import {
	type GateDecision,
	SendGateService,
	type SendPurpose,
} from "../compliance/send-gate";
import { InjectDatabase } from "../database/database.constants";
import { TelnyxClient, TelnyxSendError } from "./telnyx.client";

export class SendOutcomeUnknownError extends Error {
	constructor(
		readonly reason: string,
		options?: { cause: unknown },
	) {
		super(reason, options);
		this.name = "SendOutcomeUnknownError";
	}
}

export type OutboundSms = {
	to: string;
	contactId: string | null;
	text: string;
	purpose: SendPurpose;
	state?: string | null;
	receiptId?: string;
};

export type SendOutcome =
	| {
			status: "sent";
			telnyxId: string;
			dryRun: boolean;
			decision: GateDecision;
	  }
	| { status: "blocked"; decision: GateDecision }
	| { status: "failed"; decision: GateDecision; error: string };

@Injectable()
export class SmsSender {
	private readonly logger = new Logger(SmsSender.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly gate: SendGateService,
		private readonly telnyx: TelnyxClient,
	) {}

	async send(sms: OutboundSms): Promise<SendOutcome> {
		await this.telnyx.reserveSlot();
		const decision = await this.gate.check({
			to: sms.to,
			contactId: sms.contactId,
			purpose: sms.purpose,
			state: sms.state,
			receiptId: sms.receiptId,
		});
		if (!decision.allowed) return { status: "blocked", decision };

		try {
			const sent = await this.telnyx.send(
				{ to: sms.to, text: sms.text },
				{ slotReserved: true },
			);
			await this.record(sms, {
				telnyxId: sent.id,
				status: sent.dryRun ? SmsStatus.SENT : SmsStatus.SENDING,
				errorCode: null,
			});
			return {
				status: "sent",
				telnyxId: sent.id,
				dryRun: sent.dryRun,
				decision,
			};
		} catch (cause) {
			if (!(cause instanceof TelnyxSendError)) {
				this.logger.error(
					{
						message: "SMS outcome unknown: Telnyx may have sent the message",
						contactId: sms.contactId,
					},
					cause instanceof Error ? cause.stack : String(cause),
				);
				throw new SendOutcomeUnknownError(
					cause instanceof Error ? cause.message : "Unknown send error.",
					{ cause },
				);
			}

			this.logger.error(
				{
					message: "Telnyx did not accept the SMS",
					contactId: sms.contactId,
					status: cause.status,
					code: cause.code,
				},
				cause.stack,
			);
			await this.record(sms, {
				telnyxId: null,
				status: SmsStatus.SENDING_FAILED,
				errorCode: cause.code,
			});
			if (sms.purpose === "opt-out-confirmation") {
				await this.gate.releaseOptOutConfirmation(sms.to);
			}
			return { status: "failed", decision, error: cause.message };
		}
	}

	private async record(
		sms: OutboundSms,
		result: {
			telnyxId: string | null;
			status: SmsStatus;
			errorCode: string | null;
		},
	): Promise<void> {
		if (!sms.contactId) return;

		await this.db.smsMessage.create({
			data: {
				contactId: sms.contactId,
				direction: SmsDirection.OUTBOUND,
				body: sms.text,
				...result,
			},
		});
	}
}
