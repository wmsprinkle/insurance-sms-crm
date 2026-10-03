import { defineTool } from "eve/tools";
import { z } from "zod";
import { focusOn } from "../lib/focus";
import { bookMeeting, prismaBookingStore } from "../lib/sms-booking";
import { apiCalendarPath } from "../lib/sms-calendar";
import { apiSendPath, dryRunFrom } from "../lib/sms-outbound";
import { NOT_AN_SMS_SESSION, smsSessionOf } from "../lib/sms-session";
import { prismaSmsStore } from "../lib/sms-store";

export default defineTool({
	description:
		"Book the call time the lead picked. Pass start exactly as propose_slots returned it. The code re-checks the calendar, sends the invite with a video link, moves the deal to demo booked and texts the confirmation itself, so send nothing after a booking. It needs the lead's email for the invite: without one it answers needs-email. Set emailDeclined only when the lead refused to give an email; then the call goes on our calendar only and we phone them.",
	inputSchema: z.object({
		start: z
			.string()
			.describe("The start of the chosen slot, copied from propose_slots."),
		email: z
			.string()
			.max(254)
			.describe("The email the lead gave in this conversation.")
			.optional(),
		emailDeclined: z
			.boolean()
			.describe("True only when the lead refused to share an email.")
			.optional(),
	}),
	async execute(input, ctx) {
		const sms = smsSessionOf(ctx);
		if (!sms) return NOT_AN_SMS_SESSION;
		focusOn({ contactId: sms.contactId });

		return bookMeeting(sms.contactId, input, {
			booking: prismaBookingStore,
			calendar: apiCalendarPath(),
			delivery: {
				store: prismaSmsStore,
				sendPath: apiSendPath(),
				dryRun: dryRunFrom(),
			},
			bookingLink: sms.bookingLink,
			taskId: sms.taskId,
		});
	},
});
