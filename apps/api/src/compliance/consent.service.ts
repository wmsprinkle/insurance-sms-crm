import type { ConsentSource, Db, Prisma } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

type Client = Db | Prisma.TransactionClient;

@Injectable()
export class ConsentService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async hasActiveConsent(
		contactId: string,
		client: Client = this.db,
	): Promise<boolean> {
		const active = await client.consentRecord.findFirst({
			where: { contactId, revokedAt: null },
			select: { id: true },
		});
		return active !== null;
	}

	async revokeAll(
		contactId: string,
		at: Date,
		client: Client = this.db,
	): Promise<number> {
		const { count } = await client.consentRecord.updateMany({
			where: { contactId, revokedAt: null },
			data: { revokedAt: at },
		});
		return count;
	}

	async grant(
		input: {
			contactId: string;
			source: ConsentSource;
			capturedAt: Date;
			optInText: string;
		},
		client: Client = this.db,
	): Promise<void> {
		await client.consentRecord.create({ data: input });
	}
}
