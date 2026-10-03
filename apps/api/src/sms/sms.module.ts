import { readSmsEnv } from "@crm/env/sms";
import { Logger, Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { ComplianceModule } from "../compliance/compliance.module";
import { TrpcModule } from "../trpc/trpc.module";
import { KeywordService } from "./keyword.service";
import { RateLimiter } from "./rate-limiter";
import { SmsRouter } from "./sms.router";
import { SmsService } from "./sms.service";
import { SMS } from "./sms-config";
import { SmsSender } from "./sms-sender.service";
import { SmsThreadsService } from "./sms-threads.service";
import { TelnyxClient } from "./telnyx.client";
import { telnyxPublicKey } from "./telnyx-signature";
import {
	TELNYX_PUBLIC_KEY,
	TelnyxWebhookController,
} from "./telnyx-webhook.controller";

@Module({
	imports: [TrpcModule, AgentModule, ComplianceModule],
	controllers: [TelnyxWebhookController],
	providers: [
		SmsService,
		SmsSender,
		KeywordService,
		SmsThreadsService,
		SmsRouter,
		{
			provide: TelnyxClient,
			useFactory: () => {
				const env = readSmsEnv();
				return new TelnyxClient(
					env,
					new RateLimiter(
						env.messagesPerSecond ?? SMS.rate.defaultMessagesPerSecond,
						SMS.rate.burst,
					),
				);
			},
		},
		{
			provide: TELNYX_PUBLIC_KEY,
			useFactory: () => {
				const configured = readSmsEnv().publicKey;
				const key = telnyxPublicKey(configured);
				if (configured && !key) {
					new Logger(SmsModule.name).error({
						message:
							"TELNYX_PUBLIC_KEY is not a base64 Ed25519 key; Telnyx webhooks answer 503",
					});
				}
				return key;
			},
		},
	],
	exports: [TelnyxClient, SmsService, SmsSender],
})
export class SmsModule {}
