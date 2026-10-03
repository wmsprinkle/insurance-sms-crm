import type { StatusTone } from "@crm/ui/components/status-indicator";
import type { RouterOutputs } from "@/lib/trpc/types";

type SmsMessage = RouterOutputs["sms"]["thread"]["messages"][number];

export type SmsStatusValue = SmsMessage["status"];

export type SmsDirectionValue = SmsMessage["direction"];

const STATUS = {
	QUEUED: { label: "Queued", tone: "neutral" },
	SENDING: { label: "Sending", tone: "info" },
	SENT: { label: "Sent", tone: "info" },
	DELIVERED: { label: "Delivered", tone: "success" },
	DELIVERY_FAILED: { label: "Not delivered", tone: "error" },
	SENDING_FAILED: { label: "Not sent", tone: "error" },
	DELIVERY_UNCONFIRMED: { label: "Delivery unconfirmed", tone: "warning" },
	RECEIVED: { label: "Received", tone: "neutral" },
} satisfies Record<SmsStatusValue, { label: string; tone: StatusTone }>;

export function smsStatus(status: SmsStatusValue): {
	label: string;
	tone: StatusTone;
} {
	return STATUS[status];
}

export function smsFailed(status: SmsStatusValue): boolean {
	return status === "DELIVERY_FAILED" || status === "SENDING_FAILED";
}

export function smsPreviewPrefix(direction: SmsDirectionValue): string {
	return direction === "OUTBOUND" ? "You: " : "";
}

export type SmsThreadNotice = {
	tone: "default" | "destructive";
	title: string;
	description: string;
};

export function smsThreadNotices(thread: {
	phone: string | null;
	suppressed: boolean;
	consented: boolean;
}): SmsThreadNotice[] {
	const notices: SmsThreadNotice[] = [];
	if (!thread.phone) {
		notices.push({
			tone: "default",
			title: "No phone number",
			description: "Add a mobile number to text this contact.",
		});
	}
	if (thread.suppressed) {
		notices.push({
			tone: "destructive",
			title: "Opted out",
			description:
				"This number replied STOP or asked not to be texted. Nothing more is sent until they reply START.",
		});
	}
	if (!thread.consented) {
		notices.push({
			tone: "destructive",
			title: "No consent on file",
			description:
				"The send gate blocks every text to a contact without an active consent record.",
		});
	}
	return notices;
}

export function smsComposerBlock(thread: {
	phone: string | null;
	suppressed: boolean;
	consented: boolean;
}): string | null {
	if (!thread.phone) return "Add a phone number to text this contact.";
	if (thread.suppressed) return "This number opted out. Texting is off.";
	if (!thread.consented) return "No consent on file. Texting is off.";
	return null;
}
