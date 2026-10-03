import { readSmsEnv } from "@crm/env/sms";
import { Module } from "@nestjs/common";
import { RateLimiter } from "./rate-limiter";
import { SMS } from "./sms-config";
import { TelnyxClient } from "./telnyx.client";

@Module({
	providers: [
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
	],
	exports: [TelnyxClient],
})
export class SmsModule {}
