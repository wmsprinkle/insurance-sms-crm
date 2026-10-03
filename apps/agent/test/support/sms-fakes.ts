import type { SmsSendRequest } from "@crm/validation/sms-send";
import type { SmsSettings } from "@crm/validation/sms-settings";
import { DEFAULT_SMS_SETTINGS } from "@crm/validation/sms-settings";
import type { SendAttempt, SendPath } from "../../agent/lib/sms-outbound";
import type {
	DraftInput,
	SmsContact,
	SmsLine,
	SmsStore,
} from "../../agent/lib/sms-store";

export type FakeSms = {
	store: SmsStore;
	contacts: Map<string, SmsContact>;
	settings: SmsSettings;
	bookingLink: string | null;
	handoffs: Map<string, { reason: string; resolved: boolean }>;
	drafts: (DraftInput & { id: string })[];
	lines: Map<string, SmsLine & { id: string; contactId: string }>;
	optOuts: { contactId: string; phone: string; reason: string }[];
	suppressed: Map<string, Date>;
	consented: Set<string>;
	receipts: Set<string>;
	finished: { contactId: string; outcome: string; keep: string | null }[];
	stages: { contactId: string; stage: string }[];
	inFlight: boolean;
	deferred: { taskId: string; delayMs: number }[];
	closedTurns: { contactId: string; outcome: string }[];
};

export const LEAD = { id: "c1", firstName: "Dana", phone: "+15125550100" };

export function fakeSms(overrides: Partial<SmsSettings> = {}): FakeSms {
	const fake: Omit<FakeSms, "store"> = {
		contacts: new Map([[LEAD.id, LEAD]]),
		settings: { ...DEFAULT_SMS_SETTINGS, ...overrides },
		bookingLink: null,
		handoffs: new Map(),
		drafts: [],
		lines: new Map(),
		optOuts: [],
		suppressed: new Map(),
		consented: new Set([LEAD.id]),
		receipts: new Set(),
		finished: [],
		stages: [],
		inFlight: false,
		deferred: [],
		closedTurns: [],
	};

	const store: SmsStore = {
		contact: async (id) => fake.contacts.get(id) ?? null,
		settings: async () => fake.settings,
		bookingLink: async () => fake.bookingLink,
		activeHandoff: async (id) => {
			const handoff = fake.handoffs.get(id);
			return handoff && !handoff.resolved ? { reason: handoff.reason } : null;
		},
		openHandoff: async (id, reason) => {
			const handoff = fake.handoffs.get(id);
			if (handoff && !handoff.resolved) return false;
			fake.handoffs.set(id, { reason, resolved: false });
			return true;
		},
		saveDraft: async (draft) => {
			const id = `d${fake.drafts.length + 1}`;
			fake.drafts.push({ ...draft, id });
			return { id };
		},
		sendBlock: async (contactId, phone) => {
			if (fake.suppressed.has(phone)) return "suppressed";
			return fake.consented.has(contactId) ? null : "no-consent";
		},
		replyRecorded: async (key) =>
			fake.receipts.has(key) ||
			fake.drafts.some((draft) => draft.idempotencyKey === key),
		inboundCounts: async (contactId, since) => {
			const inbound = [...fake.lines.values()].filter(
				(line) => line.contactId === contactId && line.direction === "INBOUND",
			);
			return {
				recent: inbound.filter((line) => line.createdAt >= since).length,
				total: inbound.length,
			};
		},
		messages: async (ids) =>
			ids.flatMap((id) => {
				const line = fake.lines.get(id);
				return line ? [line] : [];
			}),
		history: async (contactId, limit) =>
			[...fake.lines.values()]
				.filter((line) => line.contactId === contactId)
				.slice(-limit),
		optOut: async ({ contactId, phone, reason }) => {
			fake.optOuts.push({ contactId, phone, reason });
			const existing = fake.suppressed.get(phone);
			const suppressedAt = existing ?? new Date(1_000 * fake.optOuts.length);
			fake.suppressed.set(phone, suppressedAt);
			fake.consented.delete(contactId);
			return { created: existing === undefined, suppressedAt };
		},
		finishSmsTasks: async (contactId, outcome, keep) => {
			fake.finished.push({ contactId, outcome, keep });
			return 0;
		},
		setDealStage: async (contactId, stage) => {
			fake.stages.push({ contactId, stage });
			return 1;
		},
		turnInFlight: async () => fake.inFlight,
		deferTask: async (taskId, delayMs) => {
			fake.deferred.push({ taskId, delayMs });
		},
		finishStartedTurns: async (contactId, outcome) => {
			fake.closedTurns.push({ contactId, outcome });
			return 1;
		},
	};

	return Object.assign(fake, { store });
}

export function addInbound(
	fake: FakeSms,
	id: string,
	body: string,
	createdAt = new Date(),
): void {
	fake.lines.set(id, {
		id,
		contactId: LEAD.id,
		direction: "INBOUND",
		body,
		createdAt,
	});
}

export type RecordingPath = { path: SendPath; calls: SmsSendRequest[] };

export function recordingPath(answer: SendAttempt): RecordingPath {
	const calls: SmsSendRequest[] = [];
	return {
		calls,
		path: async (request) => {
			calls.push(request);
			return answer;
		},
	};
}
