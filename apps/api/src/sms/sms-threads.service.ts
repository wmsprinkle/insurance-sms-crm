import { type Db, type Prisma, SmsDirection } from "@crm/db";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { paginate } from "../trpc/list-input";
import { SMS } from "./sms-config";
import { contactDisplayName, previewOf, threadSearch } from "./sms-threads";
import type {
	SmsMarkHandledOutput,
	SmsThreadInput,
	SmsThreadListInput,
	SmsThreadListOutput,
	SmsThreadOutput,
} from "./sms-threads.contracts";

const OPEN = {
	direction: SmsDirection.INBOUND,
	handledAt: null,
} satisfies Prisma.SmsMessageWhereInput;

@Injectable()
export class SmsThreadsService {
	private readonly logger = new Logger(SmsThreadsService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async list(input: SmsThreadListInput): Promise<SmsThreadListOutput> {
		const contact = threadSearch(input.q);
		const all = { contact } satisfies Prisma.SmsMessageWhereInput;
		const open = { ...OPEN, contact } satisfies Prisma.SmsMessageWhereInput;
		const scope = input.filter === "open" ? open : all;

		const [allThreads, openThreads, page] = await Promise.all([
			this.db.smsMessage.groupBy({ by: ["contactId"], where: all }),
			this.db.smsMessage.groupBy({ by: ["contactId"], where: open }),
			this.db.smsMessage.groupBy({
				by: ["contactId"],
				where: scope,
				_max: { createdAt: true },
				orderBy: { _max: { createdAt: input.dir === "asc" ? "asc" : "desc" } },
				...paginate(input),
			}),
		]);

		const contactIds = page.map((group) => group.contactId);

		const [contacts, openCounts, lastMessages] = await Promise.all([
			this.db.contact.findMany({
				where: { id: { in: contactIds } },
				select: { id: true, firstName: true, lastName: true, phone: true },
			}),
			this.db.smsMessage.groupBy({
				by: ["contactId"],
				where: { ...OPEN, contactId: { in: contactIds } },
				_count: { _all: true },
			}),
			Promise.all(
				contactIds.map((contactId) =>
					this.db.smsMessage.findFirst({
						where: { contactId },
						orderBy: { createdAt: "desc" },
						select: {
							body: true,
							direction: true,
							status: true,
							createdAt: true,
						},
					}),
				),
			),
		]);

		const contactById = new Map(contacts.map((row) => [row.id, row]));
		const openById = new Map(
			openCounts.map((row) => [row.contactId, row._count._all]),
		);

		const rows = contactIds.flatMap((contactId, index) => {
			const person = contactById.get(contactId);
			const last = lastMessages[index];
			if (!person || !last) return [];
			return [
				{
					contactId,
					name: contactDisplayName(person),
					phone: person.phone,
					lastMessage: {
						preview: previewOf(last.body, SMS.threads.previewLength),
						direction: last.direction,
						status: last.status,
						createdAt: last.createdAt.toISOString(),
					},
					openCount: openById.get(contactId) ?? 0,
				},
			];
		});

		return {
			rows,
			total: input.filter === "open" ? openThreads.length : allThreads.length,
			facetCounts: {
				filter: { open: openThreads.length, all: allThreads.length },
			},
		};
	}

	async thread(input: SmsThreadInput): Promise<SmsThreadOutput> {
		const contact = await this.db.contact.findUnique({
			where: { id: input.contactId },
			select: { id: true, phone: true },
		});

		if (!contact) {
			throw new NotFoundException("That contact does not exist.");
		}

		const [recent, openCount, suppression, consent] = await Promise.all([
			this.db.smsMessage.findMany({
				where: { contactId: contact.id },
				orderBy: { createdAt: "desc" },
				take: SMS.threads.maxMessages + 1,
				select: {
					id: true,
					direction: true,
					body: true,
					status: true,
					errorCode: true,
					handledAt: true,
					createdAt: true,
				},
			}),
			this.db.smsMessage.count({ where: { ...OPEN, contactId: contact.id } }),
			contact.phone
				? this.db.phoneSuppression.findUnique({
						where: { e164: contact.phone },
						select: { e164: true },
					})
				: null,
			this.db.consentRecord.findFirst({
				where: { contactId: contact.id, revokedAt: null },
				select: { id: true },
			}),
		]);

		const truncated = recent.length > SMS.threads.maxMessages;
		const messages = recent
			.slice(0, SMS.threads.maxMessages)
			.reverse()
			.map((message) => ({
				id: message.id,
				direction: message.direction,
				body: message.body,
				status: message.status,
				errorCode: message.errorCode,
				handledAt: message.handledAt?.toISOString() ?? null,
				createdAt: message.createdAt.toISOString(),
			}));

		return {
			contactId: contact.id,
			phone: contact.phone,
			suppressed: suppression !== null,
			consented: consent !== null,
			openCount,
			truncated,
			messages,
		};
	}

	async markHandled(input: SmsThreadInput): Promise<SmsMarkHandledOutput> {
		const { count } = await this.db.smsMessage.updateMany({
			where: { ...OPEN, contactId: input.contactId },
			data: { handledAt: new Date() },
		});

		this.logger.log({
			message: "SMS thread marked handled",
			contactId: input.contactId,
			updated: count,
		});

		return { updated: count };
	}
}
