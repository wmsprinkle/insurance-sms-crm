import type { KeyObject } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
	BadRequestException,
	Controller,
	Headers,
	HttpCode,
	Inject,
	Logger,
	PayloadTooLargeException,
	Post,
	Req,
	ServiceUnavailableException,
	UnauthorizedException,
} from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiOkResponse,
	ApiOperation,
	ApiServiceUnavailableResponse,
	ApiTags,
	ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { readRawBody } from "./raw-body";
import { SmsService } from "./sms.service";
import { SMS } from "./sms-config";
import {
	parseTelnyxEvent,
	type TelnyxEvent,
	TelnyxEventError,
} from "./telnyx-event";
import { verifyTelnyxSignature } from "./telnyx-signature";

export const TELNYX_PUBLIC_KEY = Symbol("TELNYX_PUBLIC_KEY");

export type WebhookOutcome = {
	event: TelnyxEvent["kind"];
	outcome: string;
};

@ApiTags("Webhooks")
@Controller("webhooks/telnyx")
export class TelnyxWebhookController {
	private readonly logger = new Logger(TelnyxWebhookController.name);

	constructor(
		private readonly sms: SmsService,
		@Inject(TELNYX_PUBLIC_KEY) private readonly publicKey: KeyObject | null,
	) {}

	@Post()
	@AllowAnonymous()
	@HttpCode(200)
	@ApiOperation({ summary: "Receive Telnyx messaging webhooks" })
	@ApiOkResponse({ description: "The event was verified and handled." })
	@ApiUnauthorizedResponse({
		description: "Signature missing, wrong, or older than the replay window.",
	})
	@ApiBadRequestResponse({ description: "The body is not a Telnyx event." })
	@ApiServiceUnavailableResponse({
		description: "TELNYX_PUBLIC_KEY is not set or not a valid key.",
	})
	async receive(
		@Req() request: IncomingMessage,
		@Headers("telnyx-signature-ed25519") signature?: string,
		@Headers("telnyx-timestamp") timestamp?: string,
	): Promise<WebhookOutcome> {
		if (!this.publicKey) {
			throw new ServiceUnavailableException(
				"Telnyx webhooks are not configured.",
			);
		}

		const rawBody = await readRawBody(request, SMS.webhook.maxBodyBytes);
		if (!rawBody) throw new PayloadTooLargeException();

		const check = verifyTelnyxSignature(
			{ rawBody, signature, timestamp },
			this.publicKey,
			{ nowMs: Date.now(), windowMs: SMS.webhook.replayWindowMs },
		);
		if (check !== "valid") {
			this.logger.warn({ message: "Telnyx webhook rejected", check });
			throw new UnauthorizedException(`Signature ${check}.`);
		}

		let event: TelnyxEvent;
		try {
			event = parseTelnyxEvent(rawBody.toString("utf8"));
		} catch (cause) {
			if (cause instanceof TelnyxEventError) {
				throw new BadRequestException(cause.message);
			}
			throw cause;
		}

		return { event: event.kind, outcome: await this.handle(event) };
	}

	private async handle(event: TelnyxEvent): Promise<string> {
		switch (event.kind) {
			case "received":
				return this.sms.receive(event);
			case "status":
				return this.sms.updateStatus(event);
			case "ignored":
				return "ignored";
		}
	}
}
