import { SmsStatus } from "@crm/db/enums";
import { z } from "zod";

export const TELNYX_EVENT_TYPES = {
	received: "message.received",
	sent: "message.sent",
	finalized: "message.finalized",
} as const;

const envelope = z.object({
	data: z.object({
		id: z.string().min(1),
		event_type: z.string().min(1),
	}),
});

const messagePayload = z.object({
	id: z.string().min(1),
	from: z.object({ phone_number: z.string().min(1) }),
	to: z
		.array(
			z.object({
				phone_number: z.string().min(1),
				status: z.string().optional(),
			}),
		)
		.min(1),
	text: z.string().nullish(),
	errors: z.array(z.object({ code: z.coerce.string() }).loose()).nullish(),
});

const messageEvent = z.object({
	data: z.object({
		id: z.string().min(1),
		event_type: z.enum([
			TELNYX_EVENT_TYPES.received,
			TELNYX_EVENT_TYPES.sent,
			TELNYX_EVENT_TYPES.finalized,
		]),
		payload: messagePayload,
	}),
});

export type TelnyxInbound = {
	kind: "received";
	eventId: string;
	telnyxId: string;
	from: string;
	to: string;
	text: string;
};

export type TelnyxStatusUpdate = {
	kind: "status";
	eventId: string;
	telnyxId: string;
	status: SmsStatus;
	errorCode: string | null;
};

export type TelnyxIgnored = {
	kind: "ignored";
	eventId: string;
	eventType: string;
};

export type TelnyxEvent = TelnyxInbound | TelnyxStatusUpdate | TelnyxIgnored;

export class TelnyxEventError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TelnyxEventError";
	}
}

const deliveryStatus = z.enum([
	"queued",
	"sending",
	"sent",
	"delivered",
	"sending_failed",
	"delivery_failed",
	"delivery_unconfirmed",
]);

const DELIVERY_STATUS = {
	queued: SmsStatus.QUEUED,
	sending: SmsStatus.SENDING,
	sent: SmsStatus.SENT,
	delivered: SmsStatus.DELIVERED,
	sending_failed: SmsStatus.SENDING_FAILED,
	delivery_failed: SmsStatus.DELIVERY_FAILED,
	delivery_unconfirmed: SmsStatus.DELIVERY_UNCONFIRMED,
} as const satisfies Record<z.infer<typeof deliveryStatus>, SmsStatus>;

function issues(error: z.ZodError): string {
	return error.issues
		.map((issue) => `${issue.path.join(".") || "body"} ${issue.message}`)
		.join("; ");
}

export function parseTelnyxEvent(raw: string): TelnyxEvent {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		throw new TelnyxEventError("Webhook body is not JSON.");
	}

	const head = envelope.safeParse(json);
	if (!head.success) {
		throw new TelnyxEventError(`Not a Telnyx event: ${issues(head.error)}`);
	}

	const { id: eventId, event_type: eventType } = head.data.data;
	const handled: readonly string[] = Object.values(TELNYX_EVENT_TYPES);
	if (!handled.includes(eventType)) {
		return { kind: "ignored", eventId, eventType };
	}

	const parsed = messageEvent.safeParse(json);
	if (!parsed.success) {
		throw new TelnyxEventError(
			`Unreadable ${eventType} event: ${issues(parsed.error)}`,
		);
	}

	const { payload } = parsed.data.data;
	const recipient = payload.to[0];

	if (parsed.data.data.event_type === TELNYX_EVENT_TYPES.received) {
		return {
			kind: "received",
			eventId,
			telnyxId: payload.id,
			from: payload.from.phone_number,
			to: recipient?.phone_number ?? "",
			text: payload.text ?? "",
		};
	}

	const reported = deliveryStatus.safeParse(recipient?.status);
	if (!reported.success) return { kind: "ignored", eventId, eventType };
	const status = DELIVERY_STATUS[reported.data];

	return {
		kind: "status",
		eventId,
		telnyxId: payload.id,
		status,
		errorCode: payload.errors?.[0]?.code ?? null,
	};
}

const STATUS_RANK = {
	QUEUED: 0,
	SENDING: 1,
	SENT: 2,
	DELIVERED: 3,
	DELIVERY_FAILED: 3,
	SENDING_FAILED: 3,
	DELIVERY_UNCONFIRMED: 3,
	RECEIVED: 3,
} as const satisfies Record<SmsStatus, number>;

export function statusesBelow(status: SmsStatus): SmsStatus[] {
	return Object.values(SmsStatus).filter(
		(candidate) => STATUS_RANK[candidate] < STATUS_RANK[status],
	);
}
