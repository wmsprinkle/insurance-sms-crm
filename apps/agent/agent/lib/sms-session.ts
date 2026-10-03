import {
	DISCLOSURE_MODES,
	type DisclosureMode,
} from "@crm/validation/outbound-guard";
import { z } from "zod";
import { attribute } from "./session-purpose";
import { SMS_AGENT } from "./sms-config";

export const SMS_ATTRIBUTES = {
	taskKind: "taskKind",
	contactId: "contactId",
	taskId: "taskId",
	bookingLink: "bookingLink",
	disclosure: "disclosure",
	identify: "identify",
} as const;

export type SmsSession = {
	contactId: string;
	taskId: string | null;
	taskKind: string;
	bookingLink: string | null;
	disclosure: DisclosureMode | undefined;
	identify: boolean;
};

export const IDENTIFY_ON = "yes";

const SMS_KINDS = new Set<string>(Object.values(SMS_AGENT.taskKinds));

const disclosure = z.enum(DISCLOSURE_MODES).optional().catch(undefined);

type SessionContext = Parameters<typeof attribute>[0];

export function smsSessionOf(ctx: SessionContext): SmsSession | null {
	const taskKind = attribute(ctx, SMS_ATTRIBUTES.taskKind);
	const contactId = attribute(ctx, SMS_ATTRIBUTES.contactId);
	if (!taskKind || !SMS_KINDS.has(taskKind) || !contactId) return null;

	return {
		contactId,
		taskKind,
		taskId: attribute(ctx, SMS_ATTRIBUTES.taskId),
		bookingLink: attribute(ctx, SMS_ATTRIBUTES.bookingLink),
		disclosure: disclosure.parse(
			attribute(ctx, SMS_ATTRIBUTES.disclosure) ?? undefined,
		),
		identify: attribute(ctx, SMS_ATTRIBUTES.identify) === IDENTIFY_ON,
	};
}

export const NOT_AN_SMS_SESSION = {
	ok: false as const,
	reason:
		"This tool only works inside an SMS conversation task. Nothing was sent or written.",
};

export const NO_TASK_FOR_SEND = {
	ok: false as const,
	reason:
		"This SMS session has no task. A message needs a task to send safely. Nothing was sent.",
};
