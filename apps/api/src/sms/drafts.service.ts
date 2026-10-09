import { type Db, type Prisma, SmsDirection, SmsDraftStatus } from "@crm/db";
import { lockIdempotencyKey } from "@crm/db/idempotency";
import { SETTINGS_ID } from "@crm/db/settings";
import {
	SMS_REPLY_TASK_KIND,
	type SmsReplyTaskPayload,
	smsReplyTaskPayload,
} from "@crm/validation/sms-reply-task";
import type { SmsSendPurpose } from "@crm/validation/sms-send";
import { parseSmsSettings } from "@crm/validation/sms-settings";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	guardRepText,
	heldAfterBlock,
	holdReasonLabel,
	receiptState,
	sendOutcome,
} from "./drafts";
import { SMS_DRAFTS } from "./drafts.config";
import type {
	SmsComposeInput,
	SmsDraftApproveAllOutput,
	SmsDraftApproveInput,
	SmsDraftBulkInput,
	SmsDraftDiscardAllOutput,
	SmsDraftDiscardOutput,
	SmsDraftIdInput,
	SmsDraftQueueOutput,
	SmsHandBackInput,
	SmsHandBackOutput,
	SmsSendOutcome,
} from "./drafts.contracts";
import { SMS } from "./sms-config";
import { SMS_INTERNAL } from "./sms-internal";
import { SmsInternalService } from "./sms-internal.service";
import { contactDisplayName } from "./sms-threads";

const CONTACT_SELECT = {
	firstName: true,
	lastName: true,
	phone: true,
} satisfies Prisma.ContactSelect;

@Injectable()
export class SmsDraftsService {
	private readonly logger = new Logger(SmsDraftsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(SmsInternalService) private readonly sender: SmsInternalService,
	) {}

	async queue(): Promise<SmsDraftQueueOutput> {
		const { maxDrafts, maxHandoffs } = SMS_DRAFTS.list;
		const [drafts, handoffs] = await Promise.all([
			this.db.smsDraft.findMany({
				where: { status: SmsDraftStatus.PENDING },
				orderBy: { createdAt: "asc" },
				take: maxDrafts + 1,
				include: { contact: { select: CONTACT_SELECT } },
			}),
			this.db.smsHandoff.findMany({
				where: { resolvedAt: null },
				orderBy: { createdAt: "asc" },
				take: maxHandoffs + 1,
				include: { contact: { select: CONTACT_SELECT } },
			}),
		]);

		const openHandoffs = new Set(handoffs.map((row) => row.contactId));
		const replied = new Set(
			(
				await this.db.smsMessage.findMany({
					where: {
						direction: SmsDirection.INBOUND,
						contactId: { in: drafts.map((draft) => draft.contactId) },
					},
					distinct: ["contactId"],
					select: { contactId: true },
				})
			).map((row) => row.contactId),
		);

		return {
			drafts: drafts.slice(0, maxDrafts).map((draft) => ({
				id: draft.id,
				contactId: draft.contactId,
				name: contactDisplayName(draft.contact),
				phone: draft.contact.phone,
				body: draft.body,
				reason: draft.reason,
				reasonLabel: holdReasonLabel(draft.reason),
				retryAt: draft.retryAt?.toISOString() ?? null,
				createdAt: draft.createdAt.toISOString(),
				handedOff: openHandoffs.has(draft.contactId),
				firstMessage: !replied.has(draft.contactId),
			})),
			handoffs: handoffs.slice(0, maxHandoffs).map((handoff) => ({
				id: handoff.id,
				contactId: handoff.contactId,
				name: contactDisplayName(handoff.contact),
				phone: handoff.contact.phone,
				reason: handoff.reason,
				createdAt: handoff.createdAt.toISOString(),
			})),
			truncated: drafts.length > maxDrafts || handoffs.length > maxHandoffs,
		};
	}

	async approve(
		input: SmsDraftApproveInput,
		userId: string,
	): Promise<SmsSendOutcome> {
		const draft = await this.db.smsDraft.findUnique({
			where: { id: input.draftId },
		});
		if (draft?.status !== SmsDraftStatus.PENDING) {
			return { status: "failed", error: SMS_DRAFTS.errors.gone };
		}

		const prior = await this.priorSend(draft);
		if (prior === "in-progress") {
			return { status: "failed", error: SMS_DRAFTS.errors.inProgress };
		}
		if (prior === "unknown") {
			return { status: "failed", error: SMS_DRAFTS.errors.unknownOutcome };
		}
		if (prior === "sent") {
			await this.db.smsDraft.updateMany({
				where: { id: draft.id, status: SmsDraftStatus.PENDING },
				data: {
					status: SmsDraftStatus.DISCARDED,
					decidedAt: new Date(),
					decidedById: userId,
				},
			});
			this.logger.log({
				message: "SMS draft discarded: the agent already sent it",
				draftId: draft.id,
			});
			return { status: "failed", error: SMS_DRAFTS.errors.alreadySent };
		}

		let text = draft.body;
		if (input.text !== undefined && input.text !== draft.body.trim()) {
			const guarded = guardRepText(input.text, await this.disclosure());
			if (!guarded.ok) return guarded.outcome;
			text = guarded.text;
		}

		const outcome = await this.send({
			contactId: draft.contactId,
			text,
			purpose: "conversation",
			idempotencyKey:
				draft.idempotencyKey ??
				`${SMS_DRAFTS.idempotency.draftPrefix}${draft.id}`,
			taskId: draft.taskId,
		});

		if (outcome.status === "sent") {
			await this.db.smsDraft.updateMany({
				where: { id: draft.id, status: SmsDraftStatus.PENDING },
				data: {
					status: SmsDraftStatus.APPROVED,
					body: text,
					decidedAt: new Date(),
					decidedById: userId,
				},
			});
			this.logger.log({
				message: "SMS draft approved and sent",
				draftId: draft.id,
				contactId: draft.contactId,
				edited: text !== draft.body,
			});
			return outcome;
		}

		const held = heldAfterBlock(outcome);
		if (held) {
			await this.db.smsDraft.updateMany({
				where: { id: draft.id, status: SmsDraftStatus.PENDING },
				data: held,
			});
		}
		return outcome;
	}

	private async priorSend(
		draft: Pick<
			Prisma.SmsDraftGetPayload<object>,
			"contactId" | "reason" | "taskId" | "idempotencyKey"
		>,
	): Promise<"sent" | "in-progress" | "unknown" | null> {
		const { idPrefix, sessionId, sent, claimed, unknown } =
			SMS_INTERNAL.idempotency;
		if (draft.idempotencyKey) {
			const receipt = await this.db.agentEvent.findUnique({
				where: { id: `${idPrefix}${draft.idempotencyKey}` },
				select: { type: true },
			});
			return receiptState(receipt ? [receipt.type] : []);
		}

		const uncertain: readonly string[] = SMS_DRAFTS.uncertainReasons;
		if (!draft.taskId || !uncertain.includes(draft.reason)) return null;

		const receipts = await this.db.agentEvent.findMany({
			where: {
				sessionId,
				contactId: draft.contactId,
				type: { in: [sent, claimed, unknown] },
				AND: [
					{ data: { path: ["taskId"], equals: draft.taskId } },
					{
						OR: SMS_DRAFTS.verifiedPurposes.map((purpose) => ({
							data: { path: ["purpose"], equals: purpose },
						})),
					},
				],
			},
			select: { type: true },
		});
		return receiptState(receipts.map((row) => row.type));
	}

	async discard(
		input: SmsDraftIdInput,
		userId: string,
	): Promise<SmsDraftDiscardOutput> {
		const { count } = await this.db.smsDraft.updateMany({
			where: { id: input.draftId, status: SmsDraftStatus.PENDING },
			data: {
				status: SmsDraftStatus.DISCARDED,
				decidedAt: new Date(),
				decidedById: userId,
			},
		});
		if (count > 0) {
			this.logger.log({
				message: "SMS draft discarded",
				draftId: input.draftId,
			});
		}
		return { discarded: count > 0 };
	}

	async approveAll(
		input: SmsDraftBulkInput,
		userId: string,
	): Promise<SmsDraftApproveAllOutput> {
		const ids = [...new Set(input.draftIds)];
		const drafts = await this.db.smsDraft.findMany({
			where: { id: { in: ids } },
			include: { contact: { select: CONTACT_SELECT } },
		});
		const byId = new Map(drafts.map((draft) => [draft.id, draft]));

		const items: SmsDraftApproveAllOutput["items"] = [];
		for (const draftId of ids) {
			const draft = byId.get(draftId);
			const outcome = await this.approve({ draftId }, userId);
			items.push({
				draftId,
				contactId: draft?.contactId ?? null,
				name: draft ? contactDisplayName(draft.contact) : "Unknown lead",
				outcome,
			});
		}

		this.logger.log({
			message: "SMS drafts approved in bulk",
			userId,
			requested: ids.length,
			sent: items.filter((item) => item.outcome.status === "sent").length,
		});
		return { items };
	}

	async discardAll(
		input: SmsDraftBulkInput,
		userId: string,
	): Promise<SmsDraftDiscardAllOutput> {
		const { count } = await this.db.smsDraft.updateMany({
			where: {
				id: { in: [...new Set(input.draftIds)] },
				status: SmsDraftStatus.PENDING,
			},
			data: {
				status: SmsDraftStatus.DISCARDED,
				decidedAt: new Date(),
				decidedById: userId,
			},
		});

		this.logger.log({
			message: "SMS drafts discarded in bulk",
			userId,
			discarded: count,
		});
		return { discarded: count };
	}

	async compose(input: SmsComposeInput): Promise<SmsSendOutcome> {
		const guarded = guardRepText(input.text, await this.disclosure());
		if (!guarded.ok) return guarded.outcome;

		return this.send({
			contactId: input.contactId,
			text: guarded.text,
			purpose: "conversation",
			idempotencyKey: `${SMS_DRAFTS.idempotency.composePrefix}${input.idempotencyKey}`,
			taskId: null,
		});
	}

	async handBack(input: SmsHandBackInput): Promise<SmsHandBackOutput> {
		const result = await this.db.$transaction(async (tx) => {
			const handoff = await tx.smsHandoff.findUnique({
				where: { contactId: input.contactId },
			});
			if (!handoff || handoff.resolvedAt) {
				return { resolved: false, queued: false };
			}

			const { count } = await tx.smsHandoff.updateMany({
				where: { id: handoff.id, resolvedAt: null },
				data: { resolvedAt: new Date() },
			});
			if (count === 0) return { resolved: false, queued: false };

			const queued = await this.requeueReply(
				tx,
				input.contactId,
				handoff.createdAt,
			);
			return { resolved: true, queued };
		});

		this.logger.log({
			message: "SMS conversation handed back to the agent",
			contactId: input.contactId,
			...result,
		});
		return result;
	}

	private async requeueReply(
		tx: Prisma.TransactionClient,
		contactId: string,
		since: Date,
	): Promise<boolean> {
		const contact = await tx.contact.findFirst({
			where: { id: contactId, archivedAt: null },
			select: { phone: true },
		});
		if (!contact?.phone) return false;

		const [suppressed, consent] = await Promise.all([
			tx.phoneSuppression.findUnique({
				where: { e164: contact.phone },
				select: { e164: true },
			}),
			tx.consentRecord.findFirst({
				where: { contactId, e164: contact.phone, revokedAt: null },
				select: { id: true },
			}),
		]);
		if (suppressed || !consent) return false;

		const inbound = await tx.smsMessage.findMany({
			where: {
				contactId,
				direction: SmsDirection.INBOUND,
				createdAt: { gte: since },
			},
			orderBy: { createdAt: "desc" },
			take: SMS_DRAFTS.handBack.maxMessages,
			select: { id: true },
		});
		if (inbound.length === 0) return false;

		const smsMessageIds = inbound.map((row) => row.id).reverse();
		const { priority, budget } = SMS.replyTask;
		await lockIdempotencyKey(
			tx,
			`agent-task:${SMS_REPLY_TASK_KIND}:${contactId}`,
		);

		const pending = await tx.agentTask.findFirst({
			where: {
				kind: SMS_REPLY_TASK_KIND,
				contactId,
				finishedAt: null,
				startedAt: null,
			},
			select: { id: true, payload: true },
		});

		if (pending) {
			const prior = smsReplyTaskPayload.parse(pending.payload);
			const payload: SmsReplyTaskPayload = {
				...prior,
				smsMessageIds: [...new Set([...prior.smsMessageIds, ...smsMessageIds])],
			};
			await tx.agentTask.update({
				where: { id: pending.id },
				data: { payload },
			});
			return true;
		}

		const payload: SmsReplyTaskPayload = {
			type: "sms.received",
			smsMessageIds,
			from: contact.phone,
		};
		await tx.agentTask.create({
			data: {
				contactId,
				kind: SMS_REPLY_TASK_KIND,
				reason: SMS_DRAFTS.handBack.reason,
				priority,
				budget,
				dueAt: new Date(),
				payload,
			},
		});
		return true;
	}

	private async send(request: {
		contactId: string;
		text: string;
		purpose: SmsSendPurpose;
		idempotencyKey: string;
		taskId: string | null;
	}): Promise<SmsSendOutcome> {
		const contact = await this.db.contact.findFirst({
			where: { id: request.contactId, archivedAt: null },
			select: { phone: true },
		});
		if (!contact?.phone) {
			return { status: "failed", error: SMS_DRAFTS.errors.noPhone };
		}

		const response = await this.sender.send({
			...request,
			to: contact.phone,
		});
		return sendOutcome(response);
	}

	private async disclosure() {
		const row = await this.db.appSetting.findUnique({
			where: { id: SETTINGS_ID },
			select: { sms: true },
		});
		return parseSmsSettings(row?.sms ?? null).disclosureMode;
	}
}
