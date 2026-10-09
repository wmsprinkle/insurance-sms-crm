import { defineTool } from "eve/tools";
import { z } from "zod";
import { focusOn } from "../lib/focus";
import { prismaBookingStore, proposeSlots } from "../lib/sms-booking";
import { apiCalendarPath } from "../lib/sms-calendar";
import { apiSendPath } from "../lib/sms-outbound";
import { NOT_AN_SMS_SESSION, smsSessionOf } from "../lib/sms-session";
import { prismaSmsStore } from "../lib/sms-store";

export default defineTool({
	description:
		"Find 2-3 free call times on the agency calendar for the lead in this SMS conversation, in the lead's time zone and inside business hours. Use it when the lead is qualified or asks to talk to someone. It sends nothing: offer the times yourself with send_sms.",
	inputSchema: z.object({}),
	async execute(_input, ctx) {
		const sms = smsSessionOf(ctx);
		if (!sms) return NOT_AN_SMS_SESSION;
		focusOn({ contactId: sms.contactId });

		return proposeSlots(sms.contactId, {
			booking: prismaBookingStore,
			calendar: apiCalendarPath(),
			delivery: {
				store: prismaSmsStore,
				sendPath: apiSendPath(),
			},
			bookingLink: sms.bookingLink,
			taskId: sms.taskId,
		});
	},
});
