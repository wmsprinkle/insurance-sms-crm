import type { Db, Prisma, SuppressionReason } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

type Client = Db | Prisma.TransactionClient;

@Injectable()
export class SuppressionService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async isSuppressed(e164: string, client: Client = this.db): Promise<boolean> {
		const row = await client.phoneSuppression.findUnique({
			where: { e164 },
			select: { e164: true },
		});
		return row !== null;
	}

	find(
		e164: string,
		client: Client = this.db,
	): Promise<{ reason: SuppressionReason; createdAt: Date } | null> {
		return client.phoneSuppression.findUnique({
			where: { e164 },
			select: { reason: true, createdAt: true },
		});
	}

	async suppress(
		e164: string,
		reason: SuppressionReason,
		client: Client = this.db,
	): Promise<void> {
		await client.phoneSuppression.upsert({
			where: { e164 },
			create: { e164, reason },
			update: {},
		});
	}

	async lift(
		e164: string,
		reasons: readonly SuppressionReason[],
		client: Client = this.db,
	): Promise<boolean> {
		const { count } = await client.phoneSuppression.deleteMany({
			where: { e164, reason: { in: [...reasons] } },
		});
		return count > 0;
	}
}
