import type { Db } from "@crm/db";
import { readSmsLive, writeSmsLive } from "@crm/db/settings";
import { readSmsEnv } from "@crm/env/sms";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { SMS } from "./sms-config";

export type SendingState = {
	live: boolean;
	canGoLive: boolean;
	missing: string[];
};

type Cached = { live: boolean; readAt: number };

@Injectable()
export class SendingSwitchService {
	private readonly logger = new Logger(SendingSwitchService.name);
	private cached: Cached | null = null;

	constructor(@InjectDatabase() private readonly db: Db) {}

	async isLive(): Promise<boolean> {
		const now = Date.now();
		if (this.cached && now - this.cached.readAt < SMS.sending.cacheMs) {
			return this.cached.live;
		}
		const live = await readSmsLive(this.db);
		this.cached = { live, readAt: now };
		return live;
	}

	async state(): Promise<SendingState> {
		const missing = this.missing();
		const stored = await readSmsLive(this.db);
		this.cached = { live: stored, readAt: Date.now() };
		return {
			live: stored && missing.length === 0,
			canGoLive: missing.length === 0,
			missing,
		};
	}

	async set(live: boolean): Promise<SendingState> {
		const missing = this.missing();
		if (live && missing.length > 0) {
			throw new BadRequestException(
				`Texting cannot start yet. Missing: ${missing.join(", ")}.`,
			);
		}
		await writeSmsLive(this.db, live);
		this.cached = { live, readAt: Date.now() };
		this.logger.log({ message: "Texting switch changed", live });
		return this.state();
	}

	private missing(): string[] {
		const env = readSmsEnv();
		const missing: string[] = [];
		if (!env.apiKey) missing.push("TELNYX_API_KEY");
		if (!env.fromNumber) missing.push("TELNYX_FROM_NUMBER");
		if (!env.publicKey) missing.push("TELNYX_PUBLIC_KEY");
		return missing;
	}
}
