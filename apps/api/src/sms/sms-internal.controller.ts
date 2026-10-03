import type { IncomingMessage } from "node:http";
import { type SmsSendResponse, smsSendRequest } from "@crm/validation/sms-send";
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
import { ConfigService } from "@nestjs/config";
import {
	ApiBadRequestResponse,
	ApiHeader,
	ApiOkResponse,
	ApiOperation,
	ApiPayloadTooLargeResponse,
	ApiServiceUnavailableResponse,
	ApiTags,
	ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { readRawBody } from "./raw-body";
import { bridgeAuthorised, SMS_INTERNAL } from "./sms-internal";
import { SmsInternalService } from "./sms-internal.service";

@ApiTags("Internal — Agent")
@ApiHeader({
	name: "authorization",
	description: "`Bearer <AGENT_BRIDGE_SECRET>`",
	required: true,
})
@Controller("internal/sms")
export class SmsInternalController {
	private readonly logger = new Logger(SmsInternalController.name);
	private readonly secret: string | null;

	constructor(
		@Inject(SmsInternalService) private readonly sms: SmsInternalService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret =
			config.get("AGENT_BRIDGE_SECRET", { infer: true })?.trim() || null;
	}

	@Post("send")
	@AllowAnonymous()
	@HttpCode(200)
	@ApiOperation({
		summary: "Send one SMS for the agent through the compliance gate",
	})
	@ApiOkResponse({
		description: "The SMS was sent, blocked by the gate, or refused by Telnyx.",
	})
	@ApiBadRequestResponse({ description: "The body is not a valid send." })
	@ApiUnauthorizedResponse({
		description: "The bearer token is missing or wrong.",
	})
	@ApiPayloadTooLargeResponse({ description: "The body is too large." })
	@ApiServiceUnavailableResponse({
		description: "AGENT_BRIDGE_SECRET is not set.",
	})
	async send(
		@Req() request: IncomingMessage,
		@Headers("authorization") authorization?: string,
	): Promise<SmsSendResponse> {
		if (!this.secret) {
			this.logger.error({
				message: "AGENT_BRIDGE_SECRET is not set — refusing agent SMS sends.",
			});
			throw new ServiceUnavailableException(
				"The agent bridge is not configured.",
			);
		}
		if (!bridgeAuthorised(authorization, this.secret)) {
			throw new UnauthorizedException();
		}

		const raw = await readRawBody(request, SMS_INTERNAL.body.maxBytes);
		if (raw === null) throw new PayloadTooLargeException();

		const parsed = smsSendRequest.safeParse(parseJson(raw.toString("utf8")));
		if (!parsed.success) {
			throw new BadRequestException(
				parsed.error.issues.map(
					(issue) => `${issue.path.join(".") || "body"}: ${issue.message}`,
				),
			);
		}

		return this.sms.send(parsed.data);
	}
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}
