import { Module } from "@nestjs/common";
import { MailboxModule } from "../mailbox/mailbox.module";
import { MailboxTokenService } from "../mailbox/mailbox-token.service";
import {
	CALENDAR_FETCH,
	type CalendarFetch,
	CalendarWriteClient,
} from "./calendar-write.client";

const globalFetch: CalendarFetch = (input, init) => fetch(input, init);

@Module({
	imports: [MailboxModule],
	providers: [
		{ provide: CALENDAR_FETCH, useValue: globalFetch },
		{
			provide: CalendarWriteClient,
			useFactory: (tokens: MailboxTokenService, fetcher: CalendarFetch) =>
				new CalendarWriteClient(tokens, fetcher),
			inject: [MailboxTokenService, CALENDAR_FETCH],
		},
	],
	exports: [CalendarWriteClient],
})
export class CalendarWriteModule {}
