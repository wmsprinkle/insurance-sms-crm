import { db } from "@crm/db";
import { PRIORITY } from "@crm/db/agent-tasks";
import type { CrmEventType } from "@crm/db/crm-events";
import { isClosedStage } from "@crm/db/deal-stage";
import { ActivityType, type DealStage, RecordSource } from "@crm/db/enums";
import { lockIdempotencyKey } from "@crm/db/idempotency";
import { SETTINGS_ID } from "@crm/db/settings";
import { parseCalendarSettings } from "@crm/validation/calendar-settings";
import { SMS_AGENT } from "./sms-config";

export type LeadDeal = {
	id: string;
	stage: DealStage;
	companyId: string;
	ownerId: string;
};

export type LeadContact = {
	id: string;
	firstName: string;
	lastName: string | null;
	companyId: string | null;
	ownerId: string | null;
};

export type CrmEvent = {
	type: CrmEventType;
	dealId: string;
	occurredAt: Date;
	data: { [key: string]: string | null };
};

export interface LeadDealDb {
	lock(contactId: string): Promise<void>;
	contact(contactId: string): Promise<LeadContact | null>;
	deals(contactId: string): Promise<LeadDeal[]>;
	defaultOwnerId(): Promise<string | null>;
	householdCompany(contact: LeadContact): Promise<string>;
	createDeal(input: {
		name: string;
		companyId: string;
		ownerId: string;
		stage: DealStage;
		contactId: string;
		now: Date;
	}): Promise<LeadDeal>;
	moveDeal(deal: LeadDeal, stage: DealStage, now: Date): Promise<void>;
	emit(event: CrmEvent): Promise<void>;
}

export type DealMove = {
	created: string | null;
	moved: string[];
	skipped: "no-contact" | "no-owner" | null;
};

const PROGRESS: readonly DealStage[] = SMS_AGENT.deals.progress;

function advances(from: DealStage, to: DealStage): boolean {
	if (from === to || isClosedStage(from)) return false;
	if (isClosedStage(to)) return true;
	return PROGRESS.indexOf(to) > PROGRESS.indexOf(from);
}

export function leadName(
	contact: Pick<LeadContact, "firstName" | "lastName">,
): string {
	return [contact.firstName, contact.lastName]
		.filter((part) => part?.trim())
		.join(" ");
}

export async function moveLeadDeal(
	contactId: string,
	stage: DealStage,
	store: LeadDealDb,
	now: Date = new Date(),
): Promise<DealMove> {
	await store.lock(contactId);
	const deals = await store.deals(contactId);
	const open = deals.filter((deal) => !isClosedStage(deal.stage));

	if (open.length === 0) {
		if (!SMS_AGENT.deals.createOn.has(stage)) {
			return { created: null, moved: [], skipped: null };
		}
		const contact = await store.contact(contactId);
		if (!contact) return { created: null, moved: [], skipped: "no-contact" };

		const ownerId = contact.ownerId ?? (await store.defaultOwnerId());
		if (!ownerId) return { created: null, moved: [], skipped: "no-owner" };

		const companyId =
			contact.companyId ?? (await store.householdCompany(contact));
		const deal = await store.createDeal({
			name: `${leadName(contact)}${SMS_AGENT.deals.nameSuffix}`,
			companyId,
			ownerId,
			stage,
			contactId,
			now,
		});
		await store.emit({
			type: "deal.created",
			dealId: deal.id,
			occurredAt: now,
			data: { companyId, stage },
		});
		return { created: deal.id, moved: [], skipped: null };
	}

	const moved: string[] = [];
	for (const deal of open) {
		const from = deal.stage;
		if (!advances(from, stage)) continue;
		await store.moveDeal({ ...deal }, stage, now);
		await store.emit({
			type: "deal.stage.changed",
			dealId: deal.id,
			occurredAt: now,
			data: { companyId: deal.companyId, from, to: stage },
		});
		if (isClosedStage(stage)) {
			await store.emit({
				type: "deal.closed",
				dealId: deal.id,
				occurredAt: now,
				data: { companyId: deal.companyId, from, to: stage },
			});
		}
		moved.push(deal.id);
	}
	return { created: null, moved, skipped: null };
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

const DEAL_SELECT = {
	id: true,
	stage: true,
	companyId: true,
	ownerId: true,
} as const;

export function prismaLeadDeals(tx: Tx): LeadDealDb {
	return {
		lock: (contactId) =>
			lockIdempotencyKey(tx, `${SMS_AGENT.deals.lockPrefix}${contactId}`),

		contact: (contactId) =>
			tx.contact.findFirst({
				where: { id: contactId, archivedAt: null },
				select: {
					id: true,
					firstName: true,
					lastName: true,
					companyId: true,
					ownerId: true,
				},
			}),

		deals: (contactId) =>
			tx.deal.findMany({
				where: { archivedAt: null, contacts: { some: { contactId } } },
				orderBy: { createdAt: "asc" },
				select: DEAL_SELECT,
			}),

		async defaultOwnerId() {
			const settings = await tx.appSetting.findUnique({
				where: { id: SETTINGS_ID },
				select: { calendar: true },
			});
			const chosen = parseCalendarSettings(settings?.calendar).ownerUserId;
			if (chosen) return chosen;

			const google = await tx.account.findFirst({
				where: { providerId: SMS_AGENT.deals.ownerProvider },
				orderBy: { createdAt: "asc" },
				select: { userId: true },
			});
			if (google) return google.userId;

			const first = await tx.user.findFirst({
				orderBy: { createdAt: "asc" },
				select: { id: true },
			});
			return first?.id ?? null;
		},

		async householdCompany(contact) {
			const company = await tx.company.create({
				data: {
					name: `${leadName(contact)}${SMS_AGENT.deals.householdSuffix}`,
					source: RecordSource.LEAD_IMPORT,
				},
				select: { id: true },
			});
			await tx.contact.update({
				where: { id: contact.id },
				data: { companyId: company.id },
			});
			return company.id;
		},

		async createDeal({ name, companyId, ownerId, stage, contactId, now }) {
			return tx.deal.create({
				data: {
					name,
					companyId,
					ownerId,
					stage,
					stageChangedAt: now,
					closedAt: isClosedStage(stage) ? now : null,
					contacts: {
						create: { contactId, role: SMS_AGENT.deals.contactRole },
					},
				},
				select: DEAL_SELECT,
			});
		},

		async moveDeal(deal, stage, now) {
			await tx.deal.update({
				where: { id: deal.id },
				data: {
					stage,
					stageChangedAt: now,
					closedAt: isClosedStage(stage) ? now : null,
				},
			});
			await tx.activity.create({
				data: {
					type: ActivityType.STAGE_CHANGE,
					subject: "Stage changed",
					occurredAt: now,
					companyId: deal.companyId,
					dealId: deal.id,
					createdById: deal.ownerId,
					meta: { from: deal.stage, to: stage },
				},
			});
		},

		async emit(event) {
			await tx.agentTask.create({
				data: {
					dealId: event.dealId,
					kind: "agent-event",
					reason: event.type,
					payload: {
						type: event.type,
						record: { kind: "deal", id: event.dealId },
						occurredAt: event.occurredAt.toISOString(),
						data: event.data,
					},
					priority: PRIORITY.event,
					budget: 1,
					dueAt: event.occurredAt,
				},
			});
		},
	};
}

export function ensureLeadDeal(
	contactId: string,
	stage: DealStage,
): Promise<DealMove> {
	return db.$transaction((tx) =>
		moveLeadDeal(contactId, stage, prismaLeadDeals(tx)),
	);
}
