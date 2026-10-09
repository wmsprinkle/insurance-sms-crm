import { readSmsEnv } from "@crm/env/sms";
import { Logger, Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { ComplianceModule } from "../compliance/compliance.module";
import { TrpcModule } from "../trpc/trpc.module";
import { SmsDraftsRouter } from "./drafts.router";
import { SmsDraftsService } from "./drafts.service";
import { KeywordService } from "./keyword.service";
import { RateLimiter } from "./rate-limiter";
import { SendingSwitchService } from "./sending-switch.service";
import { SmsRouter } from "./sms.router";
import { SmsService } from "./sms.service";
import { SMS } from "./sms-config";
import { SmsInternalController } from "./sms-internal.controller";
import { SmsInternalService } from "./sms-internal.service";
import { SmsSender } from "./sms-sender.service";
import { SmsThreadsService } from "./sms-threads.service";
import { TelnyxClient } from "./telnyx.client";
import { telnyxPublicKey } from "./telnyx-signature";
import {
	TELNYX_PUBLIC_KEY,
	TelnyxWebhookController,
} from "./telnyx-webhook.controller";

function telnyxClient(sending: SendingSwitchService): TelnyxClient {
	const env = readSmsEnv();
	return new TelnyxClient(
		env,
		new RateLimiter(
			env.messagesPerSecond ?? SMS.rate.defaultMessagesPerSecond,
			SMS.rate.burst,
		),
		fetch,
		() => sending.isLive(),
	);
}

@Module({
	imports: [TrpcModule, AgentModule, ComplianceModule],
	controllers: [TelnyxWebhookController, SmsInternalController],
	providers: [
		SmsService,
		SmsSender,
		KeywordService,
		SmsThreadsService,
		SmsRouter,
		SmsInternalService,
		SmsDraftsService,
		SmsDraftsRouter,
		SendingSwitchService,
		{
			provide: TelnyxClient,
			inject: [SendingSwitchService],
			useFactory: telnyxClient,
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
	exports: [TelnyxClient, SmsService, SmsSender, SendingSwitchService],
})
export class SmsModule {}
