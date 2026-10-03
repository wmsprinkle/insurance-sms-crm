import { randomUUID } from "node:crypto";
import type { SmsEnv } from "@crm/env/sms";
import { E164_PATTERN } from "@crm/validation/phone";
import { Logger } from "@nestjs/common";
import { z } from "zod";
import type { RateLimiter } from "./rate-limiter";
import { SMS } from "./sms-config";

export type SendSmsInput = {
	to: string;
	text: string;
	from?: string;
};

export type SendSmsResult = {
	id: string;
	from: string;
	dryRun: boolean;
};

export type Fetcher = typeof fetch;

export class TelnyxSendError extends Error {
	constructor(
		message: string,
		readonly status: number | null,
		readonly code: string | null,
	) {
		super(message);
		this.name = "TelnyxSendError";
	}
}

export class TelnyxUnknownOutcomeError extends Error {
	constructor(
		message: string,
		readonly status: number | null,
	) {
		super(message);
		this.name = "TelnyxUnknownOutcomeError";
	}
}

const sendResponse = z.object({
	data: z.object({ id: z.string().min(1) }),
});

const errorResponse = z
	.object({
		errors: z
			.array(z.object({ code: z.coerce.string().optional() }))
			.optional(),
	})
	.catch({});

const DRY_RUN_FROM = "dry-run";

export class TelnyxClient {
	private readonly logger = new Logger(TelnyxClient.name);

	constructor(
		private readonly env: SmsEnv,
		private readonly limiter: RateLimiter,
		private readonly fetcher: Fetcher = fetch,
	) {}

	get dryRun(): boolean {
		return this.env.dryRun;
	}

	async reserveSlot(from?: string): Promise<void> {
		await this.limiter.acquire(from ?? this.env.fromNumber ?? DRY_RUN_FROM);
	}

	async send(
		input: SendSmsInput,
		options: { slotReserved?: boolean } = {},
	): Promise<SendSmsResult> {
		if (!E164_PATTERN.test(input.to)) {
			throw new TelnyxSendError(
				"Recipient is not an E.164 number.",
				null,
				null,
			);
		}
		if (!input.text.trim()) {
			throw new TelnyxSendError("Message text is empty.", null, null);
		}

		const from = input.from ?? this.env.fromNumber;

		if (this.env.dryRun) {
			if (!options.slotReserved) {
				await this.limiter.acquire(from ?? DRY_RUN_FROM);
			}
			const id = `${SMS.telnyx.dryRunIdPrefix}${randomUUID()}`;
			this.logger.log({ message: "SMS not sent: dry run", telnyxId: id });
			return { id, from: from ?? DRY_RUN_FROM, dryRun: true };
		}

		if (!from) {
			throw new TelnyxSendError("TELNYX_FROM_NUMBER is not set.", null, null);
		}

		if (!options.slotReserved) await this.limiter.acquire(from);

		let response: Response;
		try {
			response = await this.fetcher(SMS.telnyx.messagesUrl, {
				method: "POST",
				headers: {
					authorization: `Bearer ${this.env.apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					from,
					to: input.to,
					text: input.text,
					messaging_profile_id: this.env.messagingProfileId ?? undefined,
				}),
				signal: AbortSignal.timeout(SMS.telnyx.timeoutMs),
			});
		} catch (cause) {
			throw new TelnyxUnknownOutcomeError(
				`Telnyx did not answer: ${cause instanceof Error ? cause.name : "unknown error"}.`,
				null,
			);
		}

		const body: unknown = await response.json().catch(() => null);

		if (!response.ok) {
			const code = errorResponse.parse(body).errors?.[0]?.code ?? null;
			throw new TelnyxSendError(
				`Telnyx refused the message with status ${response.status}.`,
				response.status,
				code,
			);
		}

		const parsed = sendResponse.safeParse(body);
		if (!parsed.success) {
			throw new TelnyxUnknownOutcomeError(
				"Telnyx answered without a message id.",
				response.status,
			);
		}

		return { id: parsed.data.data.id, from, dryRun: false };
	}
}
