import { createHash } from "node:crypto";
import { db, Prisma } from "@crm/db";
import { ActivityType, DealStage, SmsDirection } from "@crm/db/enums";
import type { CalendarSlot } from "@crm/validation/calendar-book";
import { z } from "zod";
import type { CalendarAttempt, CalendarPath } from "./sms-calendar";
import { SMS_AGENT } from "./sms-config";
import { type DealMove, ensureLeadDeal, leadName } from "./sms-deal";
import { type Delivery, type DeliveryDeps, deliver } from "./sms-delivery";
import { readQualification } from "./sms-qualification";

export type BookingLead = {
	id: string;
	firstName: string;
	lastName: string | null;
	email: string | null;
	phone: string | null;
	state: string | null;
};

export type BookedMeeting = {
	contactId: string;
	ownerUserId: string;
	organizerEmail: string | null;
	eventId: string;
	iCalUID: string;
	meetUrl: string | null;
	summary: string;
	description: string;
	start: Date;
	end: Date;
	attendee: { email: string; name: string } | null;
};

export interface BookingStore {
	lead(contactId: string): Promise<BookingLead | null>;
	saveEmail(contactId: string, email: string): Promise<boolean>;
	leadTyped(contactId: string, text: string): Promise<boolean>;
	recordMeeting(meeting: BookedMeeting): Promise<void>;
	moveDeal(contactId: string, stage: DealStage): Promise<DealMove>;
}

export type BookingDeps = {
	booking: BookingStore;
	calendar: CalendarPath;
	delivery: DeliveryDeps;
	bookingLink: string | null;
	taskId: string | null;
	now?: Date;
};

export type SlotOffer = { start: string; label: string };

type Unavailable = {
	status: "unavailable";
	reason: string;
	next: string;
};

export type ProposeResult =
	| { status: "slots"; timeZone: string; slots: SlotOffer[]; next: string }
	| Unavailable
	| { status: "refused"; reason: string };

export type BookResult =
	| { status: "needs-email"; next: string }
	| {
			status: "slot-taken";
			timeZone: string;
			slots: SlotOffer[];
			next: string;
	  }
	| {
			status: "booked";
			when: string;
			invited: boolean;
			meetUrl: string | null;
			dealsMoved: number;
			dealCreated: boolean;
			confirmation: Delivery["status"];
			next: string;
	  }
	| Unavailable
	| { status: "refused"; reason: string };

const NEXT = {
	offer:
		"Offer these times in one short text with the time zone and ask which works. When the lead picks one, call book_meeting with that start exactly.",
	noSlots: "No free time in the next week. ",
	needsEmail:
		"Ask the lead for the email address the calendar invite should go to. If they do not want to give one, call book_meeting again with emailDeclined true.",
	untypedEmail:
		"The invite goes only to an email on the lead's record or one the lead typed in this text thread. Ask the lead to text the address they want, then call book_meeting again.",
	taken:
		"That time was just taken. Offer these new times instead and ask which works.",
	booked:
		"Booked. The confirmation text is handled. Do not send another message unless the lead asks something new.",
	link: (link: string) =>
		`The calendar is unavailable. Send the booking link ${link} with send_sms so the lead can pick a time.`,
	handoff:
		"The calendar is unavailable and there is no booking link. Call handoff_to_human so a person sets the time.",
} as const;

function unavailableNext(bookingLink: string | null): string {
	return bookingLink ? NEXT.link(bookingLink) : NEXT.handoff;
}

export function slotLabel(start: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-US", {
		...SMS_AGENT.booking.slotFormat,
		timeZone,
	})
		.format(start)
		.replace(/\s/gu, " ");
}

export function offers(
	slots: readonly CalendarSlot[],
	timeZone: string,
): SlotOffer[] {
	return slots.map((slot) => ({
		start: slot.start,
		label: slotLabel(new Date(slot.start), timeZone),
	}));
}

export function bookingEventId(contactId: string, start: Date): string {
	return createHash("sha256")
		.update(`${contactId}|${start.toISOString()}`)
		.digest("hex");
}

function failure(attempt: CalendarAttempt, bookingLink: string | null) {
	const reason =
		attempt.status === "no-bridge"
			? attempt.reason
			: attempt.status === "unavailable"
				? `${attempt.reason}: ${attempt.detail}`
				: `Unexpected calendar answer: ${attempt.status}.`;
	return {
		status: "unavailable" as const,
		reason,
		next: unavailableNext(bookingLink),
	};
}

export async function proposeSlots(
	contactId: string,
	deps: BookingDeps,
): Promise<ProposeResult> {
	const lead = await deps.booking.lead(contactId);
	if (!lead?.phone) {
		return {
			status: "refused",
			reason: "This contact has no phone number on an active record.",
		};
	}

	const attempt = await deps.calendar({
		action: "availableSlots",
		contactId,
		phone: lead.phone,
		state: lead.state,
	});
	if (attempt.status !== "slots") return failure(attempt, deps.bookingLink);

	if (attempt.slots.length === 0) {
		return {
			status: "unavailable",
			reason: "No free slot in the search window.",
			next: `${NEXT.noSlots}${unavailableNext(deps.bookingLink)}`,
		};
	}

	return {
		status: "slots",
		timeZone: attempt.timeZone,
		slots: offers(attempt.slots, attempt.timeZone),
		next: NEXT.offer,
	};
}

const emailInput = z.email();

export type BookInput = {
	start: string;
	email?: string;
	emailDeclined?: boolean;
};

export function confirmationText(when: string, invited: boolean): string {
	return invited
		? `You are booked for ${when}. A calendar invite with a video link is on its way to your email. Reply here if you need to change it.`
		: `You are booked for ${when}. A licensed agent will call you at this number then. Reply here if you need to change it.`;
}

export async function bookMeeting(
	contactId: string,
	input: BookInput,
	deps: BookingDeps,
): Promise<BookResult> {
	const now = deps.now ?? new Date();
	const start = new Date(input.start);
	if (
		Number.isNaN(start.getTime()) ||
		start.getTime() <= now.getTime() ||
		start.getTime() > now.getTime() + SMS_AGENT.booking.horizonMs
	) {
		return {
			status: "refused",
			reason:
				"start must be one of the future times propose_slots offered. Call propose_slots again.",
		};
	}

	const lead = await deps.booking.lead(contactId);
	if (!lead?.phone) {
		return {
			status: "refused",
			reason: "This contact has no phone number on an active record.",
		};
	}

	const given = input.email?.trim().toLowerCase();
	if (given && !emailInput.safeParse(given).success) {
		return {
			status: "needs-email",
			next: `"${given}" is not an email address. ${NEXT.needsEmail}`,
		};
	}
	const onRecord = lead.email?.toLowerCase() ?? null;
	if (
		given &&
		given !== onRecord &&
		!(await deps.booking.leadTyped(contactId, given))
	) {
		return { status: "needs-email", next: NEXT.untypedEmail };
	}
	const email = given ?? onRecord;
	if (!email && !input.emailDeclined) {
		return { status: "needs-email", next: NEXT.needsEmail };
	}
	if (given && !lead.email) await deps.booking.saveEmail(contactId, given);

	const name = leadName(lead);
	const end = new Date(start.getTime() + SMS_AGENT.booking.durationMs);
	const eventId = bookingEventId(contactId, start);
	const summary = `${SMS_AGENT.booking.summary} ${name}`;
	const description = SMS_AGENT.booking.description;
	const attendee = email ? { email, name } : null;

	const attempt = await deps.calendar({
		action: "book",
		contactId,
		phone: lead.phone,
		state: lead.state,
		start: start.toISOString(),
		end: end.toISOString(),
		summary,
		description,
		attendee,
		requestId: `book:${eventId}`,
		eventId,
	});

	if (attempt.status === "slot-taken") {
		return {
			status: "slot-taken",
			timeZone: attempt.timeZone,
			slots: offers(attempt.slots, attempt.timeZone),
			next:
				attempt.slots.length > 0
					? NEXT.taken
					: `${NEXT.noSlots}${unavailableNext(deps.bookingLink)}`,
		};
	}
	if (attempt.status !== "booked") return failure(attempt, deps.bookingLink);

	await deps.booking.recordMeeting({
		contactId,
		ownerUserId: attempt.ownerUserId,
		organizerEmail: attempt.organizerEmail,
		eventId: attempt.eventId,
		iCalUID: attempt.iCalUID ?? `${attempt.eventId}@google.com`,
		meetUrl: attempt.meetUrl,
		summary,
		description,
		start,
		end,
		attendee,
	});
	const deal = await deps.booking.moveDeal(contactId, DealStage.DEMO_BOOKED);

	const when = slotLabel(start, attempt.timeZone);
	const confirmation = await deliver(
		{
			contactId,
			text: confirmationText(when, attendee !== null),
			purpose: "conversation",
			taskId: deps.taskId,
			idempotencyKey: `book_meeting:${eventId}`,
			bookingLink: null,
		},
		deps.delivery,
	);

	return {
		status: "booked",
		when,
		invited: attendee !== null,
		meetUrl: attempt.meetUrl,
		dealsMoved: deal.moved.length,
		dealCreated: deal.created !== null,
		confirmation: confirmation.status,
		next: NEXT.booked,
	};
}

function isUniqueViolation(cause: unknown): boolean {
	return (
		cause instanceof Prisma.PrismaClientKnownRequestError &&
		cause.code === "P2002"
	);
}

export const prismaBookingStore: BookingStore = {
	async lead(contactId) {
		const contact = await db.contact.findFirst({
			where: { id: contactId, archivedAt: null },
			select: {
				id: true,
				firstName: true,
				lastName: true,
				email: true,
				phone: true,
			},
		});
		if (!contact) return null;
		const facts = await readQualification(contactId);
		return { ...contact, state: facts.state ?? null };
	},

	async saveEmail(contactId, email) {
		try {
			const { count } = await db.contact.updateMany({
				where: { id: contactId, email: null },
				data: { email },
			});
			return count === 1;
		} catch (cause) {
			if (isUniqueViolation(cause)) return false;
			throw cause;
		}
	},

	async leadTyped(contactId, text) {
		const count = await db.smsMessage.count({
			where: {
				contactId,
				direction: SmsDirection.INBOUND,
				body: { contains: text, mode: "insensitive" },
			},
		});
		return count > 0;
	},

	async recordMeeting(meeting) {
		const event = await db.calendarEvent.upsert({
			where: {
				iCalUid_originalStartTime: {
					iCalUid: meeting.iCalUID,
					originalStartTime: meeting.start,
				},
			},
			create: {
				iCalUid: meeting.iCalUID,
				originalStartTime: meeting.start,
				title: meeting.summary,
				description: meeting.description,
				conferenceUrl: meeting.meetUrl,
				startsAt: meeting.start,
				endsAt: meeting.end,
				status: "confirmed",
				organizerEmail: meeting.organizerEmail,
				contactId: meeting.contactId,
				syncedByUserId: meeting.ownerUserId,
				googleEventId: meeting.eventId,
			},
			update: {
				conferenceUrl: meeting.meetUrl ?? undefined,
				contactId: meeting.contactId,
			},
			select: { id: true, companyId: true },
		});

		if (meeting.attendee) {
			await db.calendarAttendee.upsert({
				where: {
					eventId_email: { eventId: event.id, email: meeting.attendee.email },
				},
				create: {
					eventId: event.id,
					email: meeting.attendee.email,
					name: meeting.attendee.name,
					contactId: meeting.contactId,
				},
				update: { contactId: meeting.contactId },
			});
		}

		await db.activity.upsert({
			where: { calendarEventId: event.id },
			create: {
				type: ActivityType.MEETING,
				subject: meeting.summary,
				occurredAt: meeting.start,
				companyId: event.companyId,
				contactId: meeting.contactId,
				createdById: meeting.ownerUserId,
				calendarEventId: event.id,
				meta: { source: SMS_AGENT.booking.activitySource },
			},
			update: { occurredAt: meeting.start },
		});
	},

	moveDeal: ensureLeadDeal,
};
