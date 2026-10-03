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
	UnprocessableEntityException,
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
	ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import type { LeadRowResult } from "./lead-batch";
import { LeadIngestService } from "./lead-ingest.service";
import {
	type LeadSourceSecrets,
	parseLeadSourceSecrets,
	verifyLeadSignature,
} from "./lead-ingest-signature";
import { leadIngestBody } from "./leads.contracts";
import { LEAD_INGEST_HEADERS, LEADS } from "./leads-config";

export type LeadIngestResponse = {
	status: "created" | "duplicate";
	contactId: string | null;
	reasons: LeadRowResult["reasons"];
};

@ApiTags("Leads")
@Controller("leads")
export class LeadIngestController {
	private readonly logger = new Logger(LeadIngestController.name);
	private readonly secrets: LeadSourceSecrets;

	constructor(
		@Inject(LeadIngestService) private readonly ingest: LeadIngestService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secrets = this.loadSecrets(
			config.get("LEAD_INGEST_SECRETS", { infer: true }),
		);
	}

	@Post("ingest")
	@AllowAnonymous()
	@HttpCode(200)
	@ApiOperation({ summary: "Receive one lead from a signed lead source" })
	@ApiHeader({
		name: LEAD_INGEST_HEADERS.source,
		description: "The lead source id, as configured in LEAD_INGEST_SECRETS.",
		required: true,
	})
	@ApiHeader({
		name: LEAD_INGEST_HEADERS.timestamp,
		description: "Unix time in seconds when the request was signed.",
		required: true,
	})
	@ApiHeader({
		name: LEAD_INGEST_HEADERS.signature,
		description:
			"`sha256=` plus the hex HMAC-SHA256 of `<timestamp>.<raw body>` with the source's secret.",
		required: true,
	})
	@ApiOkResponse({
		description: "The lead was created, or matched an existing contact.",
	})
	@ApiBadRequestResponse({ description: "The body is not a valid lead." })
	@ApiUnauthorizedResponse({
		description: "Unknown source, stale timestamp, or a bad signature.",
	})
	@ApiPayloadTooLargeResponse({ description: "The body is too large." })
	@ApiUnprocessableEntityResponse({
		description: "The lead has no valid consent or phone. Reasons are listed.",
	})
	@ApiServiceUnavailableResponse({
		description: "LEAD_INGEST_SECRETS is not set.",
	})
	async receive(
		@Req() request: IncomingMessage,
		@Headers(LEAD_INGEST_HEADERS.source) source?: string,
		@Headers(LEAD_INGEST_HEADERS.timestamp) timestamp?: string,
		@Headers(LEAD_INGEST_HEADERS.signature) signature?: string,
	): Promise<LeadIngestResponse> {
		if (this.secrets.size === 0) {
			throw new ServiceUnavailableException("Lead ingest is not configured.");
		}

		const raw = await readBody(request, LEADS.ingest.maxBodyBytes);
		if (raw === null) throw new PayloadTooLargeException();

		const verified = verifyLeadSignature({
			secrets: this.secrets,
			source,
			timestamp,
			signature,
			body: raw,
			now: Date.now(),
		});
		if (!verified) throw new UnauthorizedException();

		const parsed = leadIngestBody.safeParse(parseJson(raw));
		if (!parsed.success) {
			throw new BadRequestException(
				parsed.error.issues.map(
					(issue) => `${issue.path.join(".") || "body"}: ${issue.message}`,
				),
			);
		}

		const result = await this.ingest.accept(source ?? "", parsed.data);
		if (result.status === "rejected") {
			throw new UnprocessableEntityException({
				status: "rejected",
				reasons: result.reasons,
			});
		}

		return {
			status: result.status === "created" ? "created" : "duplicate",
			contactId: result.contactId,
			reasons: result.reasons,
		};
	}

	private loadSecrets(value: string | undefined): LeadSourceSecrets {
		try {
			return parseLeadSourceSecrets(value);
		} catch (error) {
			this.logger.error(
				{
					message: "Lead ingest is disabled: LEAD_INGEST_SECRETS is malformed",
				},
				error instanceof Error ? error.stack : String(error),
			);
			return new Map();
		}
	}
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

async function readBody(
	request: IncomingMessage,
	limit: number,
): Promise<string | null> {
	const declared = Number(request.headers["content-length"] ?? 0);
	if (declared > limit) return null;

	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let settled = false;

		request.on("data", (chunk: Buffer) => {
			if (settled) return;
			size += chunk.length;
			if (size > limit) {
				settled = true;
				request.resume();
				resolve(null);
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => {
			if (settled) return;
			settled = true;
			resolve(Buffer.concat(chunks).toString("utf8"));
		});
		request.on("error", (error) => {
			if (settled) return;
			settled = true;
			reject(error);
		});
	});
}
