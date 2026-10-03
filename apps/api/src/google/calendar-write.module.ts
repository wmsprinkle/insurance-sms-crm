import { Module } from "@nestjs/common";
import { MailboxModule } from "../mailbox/mailbox.module";
import { MailboxTokenService } from "../mailbox/mailbox-token.service";
import { CalendarInternalController } from "./calendar-internal.controller";
import {
	CALENDAR_CLOCK,
	type CalendarClock,
	CalendarInternalService,
} from "./calendar-internal.service";
import {
	CALENDAR_FETCH,
	type CalendarFetch,
	CalendarWriteClient,
} from "./calendar-write.client";

const globalFetch: CalendarFetch = (input, init) => fetch(input, init);

const wallClock: CalendarClock = () => new Date();

@Module({
	imports: [MailboxModule],
	controllers: [CalendarInternalController],
	providers: [
		{ provide: CALENDAR_FETCH, useValue: globalFetch },
		{ provide: CALENDAR_CLOCK, useValue: wallClock },
		{
			provide: CalendarWriteClient,
			useFactory: (tokens: MailboxTokenService, fetcher: CalendarFetch) =>
				new CalendarWriteClient(tokens, fetcher),
			inject: [MailboxTokenService, CALENDAR_FETCH],
		},
		CalendarInternalService,
	],
	exports: [CalendarWriteClient],
})
export class CalendarWriteModule {}
