import { type Db, Prisma as PrismaNamespace, type RecordSource } from "@crm/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { InjectDatabase } from "../database/database.constants";
import { FirstTouchService } from "./first-touch.service";
import {
	type CheckedRow,
	candidateEmails,
	candidatePhones,
	type ExistingContacts,
	type LeadRowResult,
	type LeadTriage,
	type ReadyLead,
	triage,
} from "./lead-batch";
import type { LeadCandidate } from "./lead-validation";

@Injectable()
export class LeadWriterService {
	private readonly logger = new Logger(LeadWriterService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(AgentTriggerService) private readonly agent: AgentTriggerService,
		@Inject(FirstTouchService) private readonly firstTouch: FirstTouchService,
	) {}

	async triage(rows: CheckedRow[]): Promise<LeadTriage> {
		return triage(
			rows,
			await this.existing(candidatePhones(rows), candidateEmails(rows)),
		);
	}

	async write(
		outcome: LeadTriage,
		origin: RecordSource,
	): Promise<LeadRowResult[]> {
		const written = new Map<number, LeadRowResult>();

		for (const ready of outcome.ready) {
			written.set(ready.rowNumber, await this.writeOne(ready, origin));
		}

		const results = outcome.results.map(
			(result) => written.get(result.rowNumber) ?? result,
		);

		this.logger.log({
			message: "Leads written",
			origin,
			created: results.filter((result) => result.status === "created").length,
			duplicate: results.filter((result) => result.status === "duplicate")
				.length,
			rejected: results.filter((result) => result.status === "rejected").length,
		});

		return results;
	}

	private async writeOne(
		{ rowNumber, lead }: ReadyLead,
		origin: RecordSource,
	): Promise<LeadRowResult> {
		try {
			const contactId = await this.create(lead, origin);
			return {
				rowNumber,
				phone: lead.phone,
				status: "created",
				reasons: [],
				contactId,
			};
		} catch (cause) {
			if (!isUniqueConstraint(cause)) throw cause;

			const existing = await this.existing(
				[lead.phone],
				lead.email ? [lead.email] : [],
			);
			const phoneOwner = existing.byPhone.get(lead.phone) ?? null;
			return {
				rowNumber,
				phone: lead.phone,
				status: "duplicate",
				reasons: [phoneOwner ? "duplicate_phone" : "duplicate_email"],
				contactId:
					phoneOwner ??
					(lead.email ? (existing.byEmail.get(lead.email) ?? null) : null),
			};
		}
	}

	private async create(
		lead: LeadCandidate,
		origin: RecordSource,
	): Promise<string> {
		return this.agent.withCrmEvents(async (tx, emit) => {
			const created = await tx.contact.create({
				data: {
					firstName: lead.firstName,
					lastName: lead.lastName,
					email: lead.email,
					phone: lead.phone,
					source: origin,
					consentRecords: {
						create: {
							source: lead.consent.source,
							capturedAt: lead.consent.capturedAt,
							optInText: lead.consent.optInText,
							optInUrl: lead.consent.optInUrl,
							ip: lead.consent.ip,
						},
					},
				},
				select: {
					id: true,
					firstName: true,
					lastName: true,
					email: true,
					companyId: true,
					createdAt: true,
				},
			});
			await emit({
				type: "contact.created",
				record: { kind: "contact", id: created.id },
				occurredAt: created.createdAt,
				data: {
					firstName: created.firstName,
					lastName: created.lastName,
					email: created.email,
					companyId: created.companyId,
				},
			});
			await this.firstTouch.enqueue(tx, {
				contactId: created.id,
				phone: lead.phone,
				firstName: created.firstName,
				origin,
			});
			return created.id;
		});
	}

	private async existing(
		phones: string[],
		emails: string[],
	): Promise<ExistingContacts> {
		if (phones.length === 0 && emails.length === 0) {
			return { byPhone: new Map(), byEmail: new Map() };
		}

		const contacts = await this.db.contact.findMany({
			where: {
				archivedAt: null,
				OR: [
					{ phone: { in: phones } },
					{ email: { in: emails, mode: "insensitive" } },
				],
			},
			select: { id: true, phone: true, email: true },
		});

		const byPhone = new Map<string, string>();
		const byEmail = new Map<string, string>();
		for (const contact of contacts) {
			if (contact.phone) byPhone.set(contact.phone, contact.id);
			if (contact.email) byEmail.set(contact.email.toLowerCase(), contact.id);
		}

		return { byPhone, byEmail };
	}
}

function isUniqueConstraint(cause: unknown): boolean {
	return (
		cause instanceof PrismaNamespace.PrismaClientKnownRequestError &&
		cause.code === "P2002"
	);
}
