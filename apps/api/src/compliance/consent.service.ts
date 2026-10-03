import type { ConsentSource, Db, Prisma } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

type Client = Db | Prisma.TransactionClient;

export type ConsentSubject = { contactId: string; e164: string };

@Injectable()
export class ConsentService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async hasActiveConsent(
		subject: ConsentSubject,
		client: Client = this.db,
	): Promise<boolean> {
		const active = await client.consentRecord.findFirst({
			where: {
				contactId: subject.contactId,
				e164: subject.e164,
				revokedAt: null,
			},
			select: { id: true },
		});
		return active !== null;
	}

	async revokeAll(
		subject: { contactId: string | null; e164: string },
		at: Date,
		client: Client = this.db,
	): Promise<number> {
		const { count } = await client.consentRecord.updateMany({
			where: subject.contactId
				? {
						OR: [{ contactId: subject.contactId }, { e164: subject.e164 }],
						revokedAt: null,
					}
				: { e164: subject.e164, revokedAt: null },
			data: { revokedAt: at },
		});
		return count;
	}

	async grant(
		input: {
			contactId: string;
			e164: string;
			source: ConsentSource;
			capturedAt: Date;
			optInText: string;
		},
		client: Client = this.db,
	): Promise<void> {
		await client.consentRecord.create({ data: input });
	}
}
