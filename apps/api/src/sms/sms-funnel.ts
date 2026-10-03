import { type Db, SmsDirection } from "@crm/db";
import {
	deriveFunnelStatus,
	FUNNEL_OUTCOMES,
	type FunnelStatus,
} from "@crm/validation/funnel-status";
import { SMS_REPLY_TASK_KIND } from "@crm/validation/sms-reply-task";

export type FunnelContact = { id: string; phone: string | null };

export async function loadFunnelStatuses(
	db: Db,
	contacts: readonly FunnelContact[],
): Promise<Map<string, FunnelStatus>> {
	const ids = contacts.map((contact) => contact.id);
	const phones = contacts.flatMap((contact) =>
		contact.phone ? [contact.phone] : [],
	);
	if (ids.length === 0) return new Map();

	const [suppressions, handoffs, deals, counts, declines, turns] =
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
		]);

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
		contacts.map((contact) => [
			contact.id,
			deriveFunnelStatus({
				suppressed: contact.phone ? suppressed.has(contact.phone) : false,
				handoff: handoffBy.get(contact.id) ?? null,
				dealStages: stagesBy.get(contact.id) ?? [],
				declined: declined.has(contact.id),
				outbound: messages(contact.id, SmsDirection.OUTBOUND),
				inbound: messages(contact.id, SmsDirection.INBOUND),
				modelTurns: turnsBy.get(contact.id) ?? 0,
			}),
		]),
	);
}
