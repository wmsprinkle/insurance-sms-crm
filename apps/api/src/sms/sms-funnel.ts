import { type Db, SmsDirection } from "@crm/db";
import {
	deriveFunnelStatus,
	FUNNEL_OUTCOMES,
	type FunnelStatus,
} from "@crm/validation/funnel-status";
import { smsFailureMessage } from "@crm/validation/sms-failure";
import { SMS_REPLY_TASK_KIND } from "@crm/validation/sms-reply-task";

export type FunnelContact = { id: string; phone: string | null };

export type FunnelView = { status: FunnelStatus; attention: string | null };

export async function loadFunnelStatuses(
	db: Db,
	contacts: readonly FunnelContact[],
): Promise<Map<string, FunnelStatus>> {
	const view = await loadFunnelView(db, contacts);

	return new Map([...view].map(([id, row]) => [id, row.status]));
}

export async function loadFunnelView(
	db: Db,
	contacts: readonly FunnelContact[],
): Promise<Map<string, FunnelView>> {
	const ids = contacts.map((contact) => contact.id);
	const phones = contacts.flatMap((contact) =>
		contact.phone ? [contact.phone] : [],
	);
	if (ids.length === 0) return new Map();

	const [suppressions, handoffs, deals, counts, declines, turns, latest] =
		await Promise.all([
			db.phoneSuppression.findMany({
				where: { e164: { in: phones } },
				select: { e164: true },
			}),
			db.smsHandoff.findMany({
				where: { contactId: { in: ids } },
				select: { contactId: true, reason: true, resolvedAt: true },
			}),
			db.dealContact.findMany({
				where: { contactId: { in: ids }, deal: { archivedAt: null } },
				select: { contactId: true, deal: { select: { stage: true } } },
			}),
			db.smsMessage.groupBy({
				by: ["contactId", "direction"],
				where: { contactId: { in: ids } },
				_count: { _all: true },
			}),
			db.agentTask.groupBy({
				by: ["contactId"],
				where: {
					contactId: { in: ids },
					kind: SMS_REPLY_TASK_KIND,
					outcome: { startsWith: FUNNEL_OUTCOMES.declined },
				},
			}),
			db.agentTask.groupBy({
				by: ["contactId"],
				where: {
					contactId: { in: ids },
					kind: SMS_REPLY_TASK_KIND,
					sessionId: { not: null },
				},
				_count: { _all: true },
			}),
			db.agentTask.findMany({
				where: {
					contactId: { in: ids },
					kind: SMS_REPLY_TASK_KIND,
					finishedAt: { not: null },
				},
				orderBy: { finishedAt: "desc" },
				distinct: ["contactId"],
				select: { contactId: true, outcome: true },
			}),
		]);

	const failureBy = new Map(
		latest.flatMap((row) => {
			const message = smsFailureMessage(row.outcome);
			return row.contactId && message
				? [[row.contactId, message] as const]
				: [];
		}),
	);

	const suppressed = new Set(suppressions.map((row) => row.e164));
	const handoffBy = new Map(handoffs.map((row) => [row.contactId, row]));
	const declined = new Set(declines.map((row) => row.contactId));
	const turnsBy = new Map(turns.map((row) => [row.contactId, row._count._all]));

	const stagesBy = new Map<string, string[]>();
	for (const row of deals) {
		stagesBy.set(row.contactId, [
			...(stagesBy.get(row.contactId) ?? []),
			row.deal.stage,
		]);
	}

	const messages = (contactId: string, direction: SmsDirection) =>
		counts.find(
			(row) => row.contactId === contactId && row.direction === direction,
		)?._count._all ?? 0;

	return new Map(
		contacts.map((contact) => {
			const status = deriveFunnelStatus({
				suppressed: contact.phone ? suppressed.has(contact.phone) : false,
				handoff: handoffBy.get(contact.id) ?? null,
				dealStages: stagesBy.get(contact.id) ?? [],
				declined: declined.has(contact.id),
				outbound: messages(contact.id, SmsDirection.OUTBOUND),
				inbound: messages(contact.id, SmsDirection.INBOUND),
				modelTurns: turnsBy.get(contact.id) ?? 0,
				failedTurn: failureBy.has(contact.id),
			});
			const attention =
				status === "needs_you" ? (failureBy.get(contact.id) ?? null) : null;

			return [contact.id, { status, attention }];
		}),
	);
}

const CLOSED_STATUSES: ReadonlySet<FunnelStatus> = new Set([
	"not_interested",
	"opted_out",
	"abusive",
]);

const SETTLE_SCAN_LIMIT = 5_000;

export async function settleClosedThreads(db: Db): Promise<number> {
	const open = await db.smsMessage.findMany({
		where: { direction: SmsDirection.INBOUND, handledAt: null },
		distinct: ["contactId"],
		select: { contactId: true },
		take: SETTLE_SCAN_LIMIT,
	});
	if (open.length === 0) return 0;

	const contacts = await db.contact.findMany({
		where: { id: { in: open.map((row) => row.contactId) } },
		select: { id: true, phone: true },
	});
	const statuses = await loadFunnelStatuses(db, contacts);
	const closed = contacts
		.filter((contact) => {
			const status = statuses.get(contact.id);
			return status !== undefined && CLOSED_STATUSES.has(status);
		})
		.map((contact) => contact.id);
	if (closed.length === 0) return 0;

	const { count } = await db.smsMessage.updateMany({
		where: {
			contactId: { in: closed },
			direction: SmsDirection.INBOUND,
			handledAt: null,
		},
		data: { handledAt: new Date() },
	});
	return count;
}
