import type { IncomingMessage } from "node:http";
import {
	type CalendarBridgeResponse,
	calendarBridgeRequest,
} from "@crm/validation/calendar-book";
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
import { readRawBody } from "../sms/raw-body";
import { bridgeAuthorised } from "../sms/sms-internal";
import { CALENDAR_INTERNAL } from "./calendar-internal";
import { CalendarInternalService } from "./calendar-internal.service";

@ApiTags("Internal — Agent")
@ApiHeader({
	name: "authorization",
	description: "`Bearer <AGENT_BRIDGE_SECRET>`",
	required: true,
})
@Controller("internal/calendar")
export class CalendarInternalController {
	private readonly logger = new Logger(CalendarInternalController.name);
	private readonly secret: string | null;

	constructor(
		@Inject(CalendarInternalService)
		private readonly calendar: CalendarInternalService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret =
			config.get("AGENT_BRIDGE_SECRET", { infer: true })?.trim() || null;
	}

	@Post("book")
	@AllowAnonymous()
	@HttpCode(200)
	@ApiOperation({
		summary: "Offer free slots or book one on the owner's Google Calendar",
	})
	@ApiOkResponse({
		description:
			"Slots, a booked event, a taken slot with new slots, or why the calendar is unavailable.",
	})
	@ApiBadRequestResponse({ description: "The body is not a valid request." })
	@ApiUnauthorizedResponse({
		description: "The bearer token is missing or wrong.",
	})
	@ApiPayloadTooLargeResponse({ description: "The body is too large." })
	@ApiServiceUnavailableResponse({
		description: "AGENT_BRIDGE_SECRET is not set.",
	})
	async book(
		@Req() request: IncomingMessage,
		@Headers("authorization") authorization?: string,
	): Promise<CalendarBridgeResponse> {
		if (!this.secret) {
			this.logger.error({
				message:
					"AGENT_BRIDGE_SECRET is not set — refusing agent calendar calls.",
			});
			throw new ServiceUnavailableException(
				"The agent bridge is not configured.",
			);
		}
		if (!bridgeAuthorised(authorization, this.secret)) {
			throw new UnauthorizedException();
		}

		const raw = await readRawBody(request, CALENDAR_INTERNAL.body.maxBytes);
		if (raw === null) throw new PayloadTooLargeException();

		const parsed = calendarBridgeRequest.safeParse(
			parseJson(raw.toString("utf8")),
		);
		if (!parsed.success) {
			throw new BadRequestException(
				parsed.error.issues.map(
					(issue) => `${issue.path.join(".") || "body"}: ${issue.message}`,
				),
			);
		}

		return this.calendar.handle(parsed.data);
	}
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}
