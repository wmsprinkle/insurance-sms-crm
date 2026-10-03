import { SmsDirection, SmsStatus } from "@crm/db/enums";
import { FUNNEL_STATUSES } from "@crm/validation/funnel-status";
import { z } from "zod";
import { listInput } from "../trpc/list-input";

const SMS_THREAD_FILTERS = ["open", "all"] as const;

export const smsThreadListInput = listInput.extend({
	filter: z.enum(SMS_THREAD_FILTERS).default("open"),
});

export type SmsThreadListInput = z.infer<typeof smsThreadListInput>;

const smsThreadRow = z.object({
	contactId: z.string(),
	name: z.string(),
	phone: z.string().nullable(),
	lastMessage: z.object({
		preview: z.string(),
		direction: z.enum(SmsDirection),
		status: z.enum(SmsStatus),
		createdAt: z.string(),
	}),
	openCount: z.number().int(),
	funnelStatus: z.enum(FUNNEL_STATUSES),
	attention: z.string().nullable(),
});

type SmsThreadRow = z.infer<typeof smsThreadRow>;

export const smsThreadListOutput = z.object({
	rows: z.array(smsThreadRow),
	total: z.number().int(),
	facetCounts: z.object({
		filter: z.object({ open: z.number().int(), all: z.number().int() }),
	}),
});

export type SmsThreadListOutput = z.infer<typeof smsThreadListOutput>;

export const smsThreadInput = z.object({
	contactId: z.string().trim().min(1),
});

export type SmsThreadInput = z.infer<typeof smsThreadInput>;

const smsMessageRow = z.object({
	id: z.string(),
	direction: z.enum(SmsDirection),
	body: z.string(),
	status: z.enum(SmsStatus),
	errorCode: z.string().nullable(),
	handledAt: z.string().nullable(),
	createdAt: z.string(),
});

type SmsMessageRow = z.infer<typeof smsMessageRow>;

export const smsThreadOutput = z.object({
	contactId: z.string(),
	phone: z.string().nullable(),
	suppressed: z.boolean(),
	consented: z.boolean(),
	funnelStatus: z.enum(FUNNEL_STATUSES),
	attention: z.string().nullable(),
	openCount: z.number().int(),
	truncated: z.boolean(),
	messages: z.array(smsMessageRow),
});

export type SmsThreadOutput = z.infer<typeof smsThreadOutput>;

export const smsMarkHandledOutput = z.object({
	updated: z.number().int(),
});

export type SmsMarkHandledOutput = z.infer<typeof smsMarkHandledOutput>;

export const smsAgentSessionOutput = z.object({
	sessions: z.array(
		z.object({
			sessionId: z.string(),
			startedAt: z.string(),
			lastEventAt: z.string(),
			events: z.array(
				z.object({
					type: z.string(),
					data: z.unknown(),
					meta: z.object({ id: z.string(), at: z.string() }),
				}),
			),
		}),
	),
	truncated: z.boolean(),
});

export type SmsAgentSessionOutput = z.infer<typeof smsAgentSessionOutput>;
