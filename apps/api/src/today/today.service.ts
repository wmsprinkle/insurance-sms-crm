import { type Db, SmsDirection } from "@crm/db";
import { readSmsEnv } from "@crm/env/sms";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { loadFunnelView } from "../sms/sms-funnel";
import {
	contactDisplayName,
	previewOf,
	threadSearch,
} from "../sms/sms-threads";
import { paginate } from "../trpc/list-input";
import { type LeadStatus, leadStatusOf, statusCounts } from "./lead-status";
import { describeSetup } from "./setup";
import { messageLabel, sortTimeline, type TimelineEvent } from "./timeline";
import type {
	TodayLead,
	TodayLeadsInput,
	TodayLeadsOutput,
	TodayMeetings,
	TodaySummary,
} from "./today.contracts";
import { TODAY } from "./today-config";

type LeadContact = {
	id: string;
	firstName: string;
	lastName: string | null;
	phone: string | null;
	createdAt: Date;
};

type LastMessage = {
	contactId: string;
	body: string;
	direction: SmsDirection;
	createdAt: Date;
};

type Scan = {
	contacts: LeadContact[];
	statuses: Map<string, LeadStatus>;
	attention: Map<string, string>;
	lastMessages: Map<string, LastMessage>;
	truncated: boolean;
};

@Injectable()
export class TodayService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async summary(): Promise<TodaySummary> {
		const since = new Date(Date.now() - TODAY.kpiWindowMs);
		const env = readSmsEnv();
		const sentSince = {
			direction: SmsDirection.OUTBOUND,
			status: { in: [...TODAY.sentStatuses] },
			createdAt: { gte: since },
		};

		const [
			imported,
			leadCount,
			texted,
			replied,
			interested,
			booked,
			unknown,
			meetings,
		] = await Promise.all([
			this.db.contact.count({
				where: {
					source: "LEAD_IMPORT",
					archivedAt: null,
					createdAt: { gte: since },
				},
			}),
			this.db.contact.count({
				where: { archivedAt: null, phone: { not: null } },
			}),
			this.db.smsMessage.groupBy({ by: ["contactId"], where: sentSince }),
			this.db.smsMessage.groupBy({
				by: ["contactId"],
				where: { direction: SmsDirection.INBOUND, createdAt: { gte: since } },
			}),
			this.db.deal.count({
				where: {
					archivedAt: null,
					stage: { in: [...TODAY.interestedStages] },
					stageChangedAt: { gte: since },
				},
			}),
			this.db.calendarEvent.count({
				where: {
					contactId: { not: null },
					status: { not: TODAY.cancelledEventStatus },
					createdAt: { gte: since },
				},
			}),
			this.db.agentEvent.findMany({
				where: {
					sessionId: TODAY.agentEvents.sessionId,
					type: TODAY.agentEvents.unknown,
					contactId: { not: null },
				},
				orderBy: { emittedAt: "desc" },
				take: TODAY.maxUnknownSends,
				select: { contactId: true, emittedAt: true },
			}),
			this.db.calendarEvent.findMany({
				where: {
					contactId: { not: null },
					status: { not: TODAY.cancelledEventStatus },
					startsAt: { gte: new Date() },
				},
				orderBy: { startsAt: "asc" },
				take: TODAY.maxMeetings,
				select: {
					id: true,
					title: true,
					startsAt: true,
					conferenceUrl: true,
					contact: {
						select: { id: true, firstName: true, lastName: true },
					},
				},
			}),
		]);

		const unknownIds = unknown.flatMap((row) =>
			row.contactId ? [row.contactId] : [],
		);
		const unknownContacts = await this.db.contact.findMany({
			where: { id: { in: unknownIds }, archivedAt: null },
			select: { id: true, firstName: true, lastName: true, phone: true },
		});
		const byId = new Map(unknownContacts.map((c) => [c.id, c]));

		return {
			dryRun: env.dryRun,
			windowDays: Math.round(TODAY.kpiWindowMs / 86_400_000),
			kpis: {
				imported,
				texted: texted.length,
				replied: replied.length,
				interested,
				booked,
			},
			unknownSends: unknown.flatMap((row) => {
				const contact = row.contactId ? byId.get(row.contactId) : undefined;
				return contact
					? [
							{
								contactId: contact.id,
								name: contactDisplayName(contact),
								phone: contact.phone,
								at: row.emittedAt.toISOString(),
							},
						]
					: [];
			}),
			meetings: meetings.flatMap((event) =>
				event.contact
					? [
							{
								id: event.id,
								title: event.title,
								startsAt: event.startsAt.toISOString(),
								contactId: event.contact.id,
								name: contactDisplayName(event.contact),
								conferenceUrl: event.conferenceUrl,
							},
						]
					: [],
			),
			setup: { ...describeSetup(env, process.env), leadCount },
		};
	}

	async meetings(): Promise<TodayMeetings> {
		const now = new Date();
		const where = {
			contactId: { not: null },
			status: { not: TODAY.cancelledEventStatus },
		};
		const select = {
			id: true,
			title: true,
			startsAt: true,
			endsAt: true,
			conferenceUrl: true,
			contact: {
				select: { id: true, firstName: true, lastName: true, phone: true },
			},
		} as const;
		const [upcoming, past] = await Promise.all([
			this.db.calendarEvent.findMany({
				where: { ...where, startsAt: { gte: now } },
				orderBy: { startsAt: "asc" },
				take: TODAY.maxMeetingList,
				select,
			}),
			this.db.calendarEvent.findMany({
				where: { ...where, startsAt: { lt: now } },
				orderBy: { startsAt: "desc" },
				take: TODAY.maxMeetingList,
				select,
			}),
		]);
		const rows = (events: typeof upcoming) =>
			events.flatMap((event) =>
				event.contact
					? [
							{
								id: event.id,
								title: event.title,
								startsAt: event.startsAt.toISOString(),
								endsAt: event.endsAt.toISOString(),
								contactId: event.contact.id,
								name: contactDisplayName(event.contact),
								phone: event.contact.phone,
								conferenceUrl: event.conferenceUrl,
							},
						]
					: [],
			);
		return { upcoming: rows(upcoming), past: rows(past) };
	}

	async leads(input: TodayLeadsInput): Promise<TodayLeadsOutput> {
		const scan = await this.scan(input.q);
		const filtered =
			input.status.length === 0
				? scan.contacts
				: scan.contacts.filter((contact) =>
						input.status.includes(scan.statuses.get(contact.id) ?? "new"),
					);

		const page = paginate(input);
		const rows = filtered.slice(page.skip, page.skip + page.take).map((c) => {
			const last = scan.lastMessages.get(c.id);
			return {
				contactId: c.id,
				name: contactDisplayName(c),
				phone: c.phone,
				status: scan.statuses.get(c.id) ?? ("new" as const),
				attention: scan.attention.get(c.id) ?? null,
				createdAt: c.createdAt.toISOString(),
				lastMessage: last
					? {
							preview: previewOf(last.body, TODAY.preview.length),
							direction: last.direction,
							at: last.createdAt.toISOString(),
						}
					: null,
			};
		});

		return {
			rows,
			total: filtered.length,
			statusCounts: statusCounts(
				scan.contacts.map((c) => scan.statuses.get(c.id) ?? "new"),
			),
			truncated: scan.truncated,
		};
	}

	async lead(contactId: string): Promise<TodayLead> {
		const contact = await this.db.contact.findFirst({
			where: { id: contactId, archivedAt: null },
			select: {
				id: true,
				firstName: true,
				lastName: true,
				phone: true,
				email: true,
				createdAt: true,
			},
		});
		if (!contact) throw new NotFoundException("That lead does not exist.");

		const phone = contact.phone;
		const [consent, suppression, messages, handoff, drafts, bookings] =
			await Promise.all([
				this.db.consentRecord.findFirst({
					where: { contactId: contact.id },
					orderBy: { capturedAt: "desc" },
				}),
				phone
					? this.db.phoneSuppression.findUnique({ where: { e164: phone } })
					: null,
				this.db.smsMessage.findMany({
					where: { contactId: contact.id },
					orderBy: { createdAt: "desc" },
					take: TODAY.maxTimelineEvents,
					select: { direction: true, createdAt: true },
				}),
				this.db.smsHandoff.findUnique({ where: { contactId: contact.id } }),
				this.db.smsDraft.findMany({
					where: { contactId: contact.id, status: "PENDING" },
					select: { createdAt: true },
				}),
				this.db.calendarEvent.findMany({
					where: {
						contactId: contact.id,
						status: { not: TODAY.cancelledEventStatus },
					},
					select: { title: true, startsAt: true, createdAt: true },
				}),
			]);

		const [funnel, unknownSends] = await Promise.all([
			loadFunnelView(this.db, [contact]),
			this.db.agentEvent.count({
				where: {
					contactId: contact.id,
					sessionId: TODAY.agentEvents.sessionId,
					type: TODAY.agentEvents.unknown,
				},
			}),
		]);
		const events: TimelineEvent[] = [
			{ at: contact.createdAt, kind: "imported", label: "Lead added" },
			...messages.map((m) => ({
				at: m.createdAt,
				...messageLabel(m.direction),
			})),
			...drafts.map((d) => ({
				at: d.createdAt,
				kind: "draft" as const,
				label: "A reply is waiting for your approval",
			})),
			...bookings.map((b) => ({
				at: b.createdAt,
				kind: "booked" as const,
				label: `Meeting booked${b.title ? `: ${b.title}` : ""}`,
			})),
		];
		if (consent) {
			events.push({
				at: consent.capturedAt,
				kind: "consent",
				label: "Consent to text was recorded",
			});
		}
		if (handoff) {
			events.push({
				at: handoff.createdAt,
				kind: "handoff",
				label: handoff.resolvedAt
					? "A person took over, then handed back"
					: "A person took over this conversation",
			});
		}
		if (suppression) {
			events.push({
				at: suppression.createdAt,
				kind: "opted_out",
				label: "The number was blocked from texts",
			});
		}

		return {
			contactId: contact.id,
			name: contactDisplayName(contact),
			phone,
			email: contact.email,
			attention: funnel.get(contact.id)?.attention ?? null,
			status: leadStatusOf(funnel.get(contact.id)?.status ?? "new", {
				booked: bookings.length > 0,
				pendingDraft: drafts.length > 0,
				unknownSend: unknownSends > 0,
			}),
			dryRun: readSmsEnv().dryRun,
			handoffOpen: Boolean(handoff && !handoff.resolvedAt),
			consent: consent
				? {
						source: consent.source,
						capturedAt: consent.capturedAt.toISOString(),
						optInText: consent.optInText,
						optInUrl: consent.optInUrl,
						revokedAt: consent.revokedAt?.toISOString() ?? null,
					}
				: null,
			suppression: suppression
				? {
						reason: suppression.reason,
						at: suppression.createdAt.toISOString(),
					}
				: null,
			timeline: sortTimeline(events, TODAY.maxTimelineEvents).map((event) => ({
				at: event.at.toISOString(),
				kind: event.kind,
				label: event.label,
			})),
		};
	}

	private async scan(q: string): Promise<Scan> {
		const contacts = await this.db.contact.findMany({
			where: { AND: [threadSearch(q), { phone: { not: null } }] },
			orderBy: { createdAt: "desc" },
			take: TODAY.maxLeadsScanned + 1,
			select: {
				id: true,
				firstName: true,
				lastName: true,
				phone: true,
				createdAt: true,
			},
		});
		const truncated = contacts.length > TODAY.maxLeadsScanned;
		const scanned = contacts.slice(0, TODAY.maxLeadsScanned);
		const ids = scanned.map((c) => c.id);

		const [funnel, bookings, drafts, unknowns, lastMessages] =
			await Promise.all([
				loadFunnelView(this.db, scanned),
				this.db.calendarEvent.groupBy({
					by: ["contactId"],
					where: {
						contactId: { in: ids },
						status: { not: TODAY.cancelledEventStatus },
					},
				}),
				this.db.smsDraft.groupBy({
					by: ["contactId"],
					where: { contactId: { in: ids }, status: "PENDING" },
				}),
				this.db.agentEvent.groupBy({
					by: ["contactId"],
					where: {
						contactId: { in: ids },
						sessionId: TODAY.agentEvents.sessionId,
						type: TODAY.agentEvents.unknown,
					},
				}),
				this.db.smsMessage.findMany({
					where: { contactId: { in: ids } },
					distinct: ["contactId"],
					orderBy: [{ contactId: "asc" }, { createdAt: "desc" }],
					select: {
						contactId: true,
						body: true,
						direction: true,
						createdAt: true,
					},
				}),
			]);

		const booked = new Set(bookings.map((row) => row.contactId));
		const pendingDraft = new Set(drafts.map((row) => row.contactId));
		const unknownSend = new Set(unknowns.map((row) => row.contactId));

		const statuses = new Map<string, LeadStatus>();
		for (const contact of scanned) {
			statuses.set(
				contact.id,
				leadStatusOf(funnel.get(contact.id)?.status ?? "new", {
					booked: booked.has(contact.id),
					pendingDraft: pendingDraft.has(contact.id),
					unknownSend: unknownSend.has(contact.id),
				}),
			);
		}

		return {
			contacts: scanned,
			statuses,
			attention: new Map(
				[...funnel].flatMap(([id, view]) =>
					view.attention ? [[id, view.attention] as const] : [],
				),
			),
			lastMessages: new Map(lastMessages.map((m) => [m.contactId, m])),
			truncated,
		};
	}
}
