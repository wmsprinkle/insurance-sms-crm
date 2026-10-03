import { ConsentSource, SmsDirection, SuppressionReason } from "@crm/db/enums";
import { z } from "zod";
import { listInput } from "../trpc/list-input";
import { LEAD_STATUSES } from "./lead-status";
import { TIMELINE_KINDS } from "./timeline";

const leadStatus = z.enum(LEAD_STATUSES);

export const todaySummaryOutput = z.object({
	dryRun: z.boolean(),
	windowDays: z.number().int(),
	kpis: z.object({
		imported: z.number().int(),
		texted: z.number().int(),
		replied: z.number().int(),
		interested: z.number().int(),
		booked: z.number().int(),
	}),
	unknownSends: z.array(
		z.object({
			contactId: z.string(),
			name: z.string(),
			phone: z.string().nullable(),
			at: z.string(),
		}),
	),
	meetings: z.array(
		z.object({
			id: z.string(),
			title: z.string().nullable(),
			startsAt: z.string(),
			contactId: z.string(),
			name: z.string(),
			conferenceUrl: z.string().nullable(),
		}),
	),
	setup: z.object({
		telnyxConfigured: z.boolean(),
		telnyxApiKeySet: z.boolean(),
		telnyxNumberSet: z.boolean(),
		telnyxProfileSet: z.boolean(),
		webhookKeySet: z.boolean(),
		fromNumberMasked: z.string().nullable(),
		modelKeySet: z.boolean(),
		webhookUrl: z.string(),
		leadCount: z.number().int(),
	}),
});

export type TodaySummary = z.infer<typeof todaySummaryOutput>;

export const todayLeadsInput = listInput.extend({
	status: z.array(leadStatus).default([]),
});

export type TodayLeadsInput = z.infer<typeof todayLeadsInput>;

export const todayLeadsOutput = z.object({
	rows: z.array(
		z.object({
			contactId: z.string(),
			name: z.string(),
			phone: z.string().nullable(),
			status: leadStatus,
			createdAt: z.string(),
			lastMessage: z
				.object({
					preview: z.string(),
					direction: z.enum(SmsDirection),
					at: z.string(),
				})
				.nullable(),
		}),
	),
	total: z.number().int(),
	statusCounts: z.record(leadStatus, z.number().int()),
	truncated: z.boolean(),
});

export type TodayLeadsOutput = z.infer<typeof todayLeadsOutput>;

export const todayLeadInput = z.object({
	contactId: z.string().trim().min(1),
});

export const todayLeadOutput = z.object({
	contactId: z.string(),
	name: z.string(),
	phone: z.string().nullable(),
	email: z.string().nullable(),
	status: leadStatus,
	dryRun: z.boolean(),
	handoffOpen: z.boolean(),
	consent: z
		.object({
			source: z.enum(ConsentSource),
			capturedAt: z.string(),
			optInText: z.string().nullable(),
			optInUrl: z.string().nullable(),
			revokedAt: z.string().nullable(),
		})
		.nullable(),
	suppression: z
		.object({
			reason: z.enum(SuppressionReason),
			at: z.string(),
		})
		.nullable(),
	timeline: z.array(
		z.object({
			at: z.string(),
			kind: z.enum(TIMELINE_KINDS),
			label: z.string(),
		}),
	),
});

export type TodayLead = z.infer<typeof todayLeadOutput>;

const meetingRow = z.object({
	id: z.string(),
	title: z.string().nullable(),
	startsAt: z.string(),
	endsAt: z.string(),
	contactId: z.string(),
	name: z.string(),
	phone: z.string().nullable(),
	conferenceUrl: z.string().nullable(),
});

export const todayMeetingsOutput = z.object({
	upcoming: z.array(meetingRow),
	past: z.array(meetingRow),
});

export type TodayMeetings = z.infer<typeof todayMeetingsOutput>;
