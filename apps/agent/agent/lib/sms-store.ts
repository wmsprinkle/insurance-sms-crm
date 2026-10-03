import { db } from "@crm/db";
import {
	type DealStage,
	SmsDirection,
	SmsDraftStatus,
	SuppressionReason,
} from "@crm/db/enums";
import { SETTINGS_ID } from "@crm/db/settings";
import { WORKSPACE_ID } from "@crm/db/workspace";
import { parseCalendarSettings } from "@crm/validation/calendar-settings";
import type { SmsHoldReason } from "@crm/validation/sms-send";
import {
	parseSmsSettings,
	resolveBrand,
	type SmsSettings,
} from "@crm/validation/sms-settings";
import { SMS_AGENT } from "./sms-config";
import { ensureLeadDeal } from "./sms-deal";

export type SmsContact = {
	id: string;
	firstName: string;
	phone: string | null;
};

export type SmsLine = {
	direction: SmsDirection;
	body: string;
	createdAt: Date;
};

export type DraftInput = {
	contactId: string;
	body: string;
	reason: SmsHoldReason;
	retryAt: Date | null;
	taskId: string | null;
	idempotencyKey: string | null;
};

export type SendBlock = "suppressed" | "no-consent";

export type OptOutResult = { created: boolean; suppressedAt: Date };

export type OptOutReason = "opt_out" | "wrong_number";

export interface SmsStore {
	contact(contactId: string): Promise<SmsContact | null>;
	settings(): Promise<SmsSettings>;
	brand(): Promise<string>;
	bookingLink(): Promise<string | null>;
	activeHandoff(contactId: string): Promise<{ reason: string } | null>;
	openHandoff(contactId: string, reason: string): Promise<boolean>;
	saveDraft(draft: DraftInput): Promise<{ id: string }>;
	sendBlock(contactId: string, phone: string): Promise<SendBlock | null>;
	replyRecorded(idempotencyKey: string): Promise<boolean>;
	inboundCounts(
		contactId: string,
		since: Date,
	): Promise<{ recent: number; total: number }>;
	messages(ids: readonly string[]): Promise<SmsLine[]>;
	history(contactId: string, limit: number): Promise<SmsLine[]>;
	optOut(input: {
		contactId: string;
		phone: string;
		reason: OptOutReason;
		keepTaskId: string | null;
	}): Promise<OptOutResult>;
	finishSmsTasks(
		contactId: string,
		outcome: string,
		keepTaskId: string | null,
	): Promise<number>;
	setDealStage(contactId: string, stage: DealStage): Promise<number>;
	turnInFlight(contactId: string, exceptTaskId: string): Promise<boolean>;
	deferTask(taskId: string, delayMs: number): Promise<void>;
	finishStartedTurns(contactId: string, outcome: string): Promise<number>;
	modelTurns(
		contactId: string,
		since: Date,
	): Promise<{ recent: number; total: number }>;
	discardDrafts(contactId: string): Promise<number>;
	markInboundHandled(contactId: string): Promise<number>;
}

const SMS_TASK_KINDS = Object.values(SMS_AGENT.taskKinds);

const SUPPRESSION_FOR = {
	opt_out: SuppressionReason.OPT_OUT_REQUEST,
	wrong_number: SuppressionReason.WRONG_NUMBER,
} as const satisfies Record<OptOutReason, SuppressionReason>;

const LINE_SELECT = { direction: true, body: true, createdAt: true } as const;

export const prismaSmsStore: SmsStore = {
	async contact(contactId) {
		return db.contact.findFirst({
			where: { id: contactId, archivedAt: null },
			select: { id: true, firstName: true, phone: true },
		});
	},

	async settings() {
		const row = await db.appSetting.findUnique({
			where: { id: SETTINGS_ID },
			select: { sms: true },
		});
		return parseSmsSettings(row?.sms);
	},

	async brand() {
		const [row, workspace] = await Promise.all([
			db.appSetting.findUnique({
				where: { id: SETTINGS_ID },
				select: { sms: true },
			}),
			db.organization.findUnique({
				where: { id: WORKSPACE_ID },
				select: { name: true },
			}),
		]);
		return resolveBrand(parseSmsSettings(row?.sms).brandName, workspace?.name);
	},

	async bookingLink() {
		const row = await db.appSetting.findUnique({
			where: { id: SETTINGS_ID },
			select: { calendar: true },
		});
		return parseCalendarSettings(row?.calendar).fallbackBookingLink;
	},

	async activeHandoff(contactId) {
		return db.smsHandoff.findFirst({
			where: { contactId, resolvedAt: null },
			select: { reason: true },
		});
	},

	async openHandoff(contactId, reason) {
		const existing = await db.smsHandoff.findUnique({
			where: { contactId },
			select: { resolvedAt: true },
		});
		if (existing && existing.resolvedAt === null) return false;

		await db.smsHandoff.upsert({
			where: { contactId },
			create: { contactId, reason },
			update: { reason, createdAt: new Date(), resolvedAt: null },
		});
		return true;
	},

	async saveDraft(draft) {
		return db.smsDraft.create({ data: draft, select: { id: true } });
	},

	async sendBlock(contactId, phone) {
		const [suppressed, consents] = await Promise.all([
			db.phoneSuppression.findUnique({
				where: { e164: phone },
				select: { e164: true },
			}),
			db.consentRecord.count({
				where: { contactId, e164: phone, revokedAt: null },
			}),
		]);
		if (suppressed) return "suppressed";
		return consents > 0 ? null : "no-consent";
	},

	async replyRecorded(idempotencyKey) {
		const [drafts, receipt] = await Promise.all([
			db.smsDraft.count({ where: { idempotencyKey } }),
			db.agentEvent.findUnique({
				where: { id: `${SMS_AGENT.receipts.sendPrefix}${idempotencyKey}` },
				select: { id: true },
			}),
		]);
		return drafts > 0 || receipt !== null;
	},

	async inboundCounts(contactId, since) {
		const [recent, total] = await Promise.all([
			db.smsMessage.count({
				where: {
					contactId,
					direction: SmsDirection.INBOUND,
					createdAt: { gte: since },
				},
			}),
			db.smsMessage.count({
				where: { contactId, direction: SmsDirection.INBOUND },
			}),
		]);
		return { recent, total };
	},

	async messages(ids) {
		return db.smsMessage.findMany({
			where: { id: { in: [...ids] } },
			orderBy: { createdAt: "asc" },
			select: LINE_SELECT,
		});
	},

	async history(contactId, limit) {
		const rows = await db.smsMessage.findMany({
			where: { contactId },
			orderBy: { createdAt: "desc" },
			take: limit,
			select: LINE_SELECT,
		});
		return rows.reverse();
	},

	async optOut({ contactId, phone, reason, keepTaskId }) {
		const now = new Date();
		return db.$transaction(async (tx) => {
			const existing = await tx.phoneSuppression.findUnique({
				where: { e164: phone },
				select: { createdAt: true },
			});
			const suppression =
				existing ??
				(await tx.phoneSuppression.create({
					data: { e164: phone, reason: SUPPRESSION_FOR[reason] },
					select: { createdAt: true },
				}));
			await tx.consentRecord.updateMany({
				where: { contactId, revokedAt: null },
				data: { revokedAt: now },
			});
			await tx.agentTask.updateMany({
				where: {
					contactId,
					kind: { in: SMS_TASK_KINDS },
					finishedAt: null,
					id: keepTaskId ? { not: keepTaskId } : undefined,
				},
				data: { finishedAt: now, outcome: SMS_AGENT.outcomes.optedOut },
			});
			await tx.smsDraft.updateMany({
				where: { contactId, status: SmsDraftStatus.PENDING },
				data: { status: SmsDraftStatus.DISCARDED, decidedAt: now },
			});
			return {
				created: existing === null,
				suppressedAt: suppression.createdAt,
			};
		});
	},

	async markInboundHandled(contactId) {
		const { count } = await db.smsMessage.updateMany({
			where: {
				contactId,
				direction: SmsDirection.INBOUND,
				handledAt: null,
			},
			data: { handledAt: new Date() },
		});
		return count;
	},

	async finishSmsTasks(contactId, outcome, keepTaskId) {
		const { count } = await db.agentTask.updateMany({
			where: {
				contactId,
				kind: { in: SMS_TASK_KINDS },
				finishedAt: null,
				id: keepTaskId ? { not: keepTaskId } : undefined,
			},
			data: { finishedAt: new Date(), outcome },
		});
		return count;
	},

	async setDealStage(contactId, stage) {
		const move = await ensureLeadDeal(contactId, stage);
		return move.moved.length + (move.created ? 1 : 0);
	},

	async turnInFlight(contactId, exceptTaskId) {
		const running = await db.agentTask.count({
			where: {
				contactId,
				kind: SMS_AGENT.taskKinds.reply,
				finishedAt: null,
				sessionId: { not: null },
				id: { not: exceptTaskId },
			},
		});
		return running > 0;
	},

	async deferTask(taskId, delayMs) {
		await db.agentTask.updateMany({
			where: { id: taskId, finishedAt: null },
			data: {
				dueAt: new Date(Date.now() + delayMs),
				leasedUntil: null,
				startedAt: null,
				attempts: { decrement: 1 },
			},
		});
	},

	async modelTurns(contactId, since) {
		const where = {
			contactId,
			kind: SMS_AGENT.taskKinds.reply,
			sessionId: { not: null },
		} as const;
		const [recent, total] = await Promise.all([
			db.agentTask.count({ where: { ...where, startedAt: { gte: since } } }),
			db.agentTask.count({ where }),
		]);
		return { recent, total };
	},

	async discardDrafts(contactId) {
		const { count } = await db.smsDraft.updateMany({
			where: { contactId, status: SmsDraftStatus.PENDING },
			data: { status: SmsDraftStatus.DISCARDED, decidedAt: new Date() },
		});
		return count;
	},

	async finishStartedTurns(contactId, outcome) {
		const { count } = await db.agentTask.updateMany({
			where: {
				contactId,
				kind: SMS_AGENT.taskKinds.reply,
				finishedAt: null,
				sessionId: { not: null },
			},
			data: { finishedAt: new Date(), outcome },
		});
		return count;
	},
};
