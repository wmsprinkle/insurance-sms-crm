import { GOOGLE_PROVIDER_ID } from "@crm/auth/scopes";
import type { Db } from "@crm/db";
import {
	DEFAULT_AGENT_MODEL,
	maskKey,
	readAgentModel,
	readArchiveRetentionDays,
	readContextDevKey,
	SETTINGS_ID,
	writeAgentModel,
	writeArchiveRetentionDays,
	writeContextDevKey,
} from "@crm/db/settings";
import {
	type CalendarSettings,
	parseCalendarSettings,
} from "@crm/validation/calendar-settings";
import {
	DEFAULT_SMS_SETTINGS,
	parseSmsSettings,
	type SmsSettings,
} from "@crm/validation/sms-settings";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ResearchKeyService } from "../agent/research-key.service";
import { BackfillService } from "../backfill/backfill.service";
import { COMPLIANCE } from "../compliance/compliance-config";
import { InjectDatabase } from "../database/database.constants";
import { ModelCatalogService } from "./model-catalog.service";
import { quietHoursTable } from "./quiet-hours-table";
import type {
	AgentModelSettings,
	ArchiveRetentionSettings,
	CalendarSettingsResult,
	ComplianceLimitsResult,
	ModelCatalogResult,
	QuietHoursResult,
	ResearchKeySettings,
	SmsSettingsResult,
} from "./settings.contracts";

@Injectable()
export class SettingsService {
	private readonly logger = new Logger(SettingsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly catalog: ModelCatalogService,
		private readonly researchKeys: ResearchKeyService,
		private readonly backfill: BackfillService,
	) {}

	async agentModel(): Promise<AgentModelSettings> {
		const [model, row] = await Promise.all([
			readAgentModel(this.db),
			this.db.appSetting.findFirst({ select: { updatedAt: true } }),
		]);

		return {
			selectedId: model.isDefault ? null : model.id,
			effectiveId: model.id,
			defaultId: DEFAULT_AGENT_MODEL.id,
			effective: await this.catalog.find(model.id),
			updatedAt: row?.updatedAt.toISOString() ?? null,
		};
	}

	async setAgentModel(modelId: string | null): Promise<AgentModelSettings> {
		if (modelId === null) {
			await writeAgentModel(this.db, null);
			this.logger.log({ message: "Agent model reset to the default" });
			return this.agentModel();
		}

		const models = await this.catalog.models();

		if (!models) {
			throw new BadRequestException(
				"Could not reach the AI Gateway to check that model. Try again in a moment.",
			);
		}

		const chosen = models.find((model) => model.id === modelId);

		if (!chosen) {
			throw new BadRequestException(
				`The AI Gateway does not serve a tool-using model called "${modelId}".`,
			);
		}

		await writeAgentModel(this.db, {
			id: chosen.id,
			contextWindowTokens: chosen.contextWindowTokens,
		});

		this.logger.log({ message: "Agent model changed", modelId: chosen.id });

		return this.agentModel();
	}

	async modelCatalog(): Promise<ModelCatalogResult> {
		const models = await this.catalog.models();
		return { models: models ?? [], available: models !== null };
	}

	async researchKey(): Promise<ResearchKeySettings> {
		const key = await readContextDevKey(this.db);

		return { configured: key !== null, hint: key ? maskKey(key) : null };
	}

	async setResearchKey(apiKey: string): Promise<ResearchKeySettings> {
		const check = await this.researchKeys.verify(apiKey);

		if (check.outcome === "invalid") {
			throw new BadRequestException(check.reason);
		}

		await writeContextDevKey(this.db, apiKey);

		this.logger.log({
			message: "Context key saved",
			verified: check.outcome === "valid",
		});

		// Every company added while there was no key is still PENDING, because a
		// brand task with nowhere to look leaves the record alone. The sign-in
		// sweep would find them, but the person who just fixed it is standing
		// here — so pick the work up now rather than on their next sign-in.
		void this.backfill
			.run("companies")
			.then(({ queued, remaining }) => {
				if (queued > 0) {
					this.logger.log({
						message: "Queued the research that was waiting on a key",
						queued,
						remaining,
					});
				}
			})
			.catch((cause: unknown) => {
				this.logger.warn(
					{ message: "Could not queue the waiting research" },
					cause instanceof Error ? cause.stack : String(cause),
				);
			});

		return this.researchKey();
	}

	async archiveRetention(): Promise<ArchiveRetentionSettings> {
		return { days: await readArchiveRetentionDays(this.db) };
	}

	async setArchiveRetention(days: number): Promise<ArchiveRetentionSettings> {
		const saved = await writeArchiveRetentionDays(this.db, days);

		this.logger.log({
			message: "Archive retention changed",
			days: saved,
		});

		return { days: saved };
	}

	async sms(): Promise<SmsSettingsResult> {
		const row = await this.db.appSetting.findUnique({
			where: { id: SETTINGS_ID },
			select: { sms: true },
		});

		return {
			settings: parseSmsSettings(row?.sms),
			defaults: { ...DEFAULT_SMS_SETTINGS },
		};
	}

	async setSms(settings: SmsSettings): Promise<SmsSettingsResult> {
		await this.db.appSetting.upsert({
			where: { id: SETTINGS_ID },
			create: { id: SETTINGS_ID, sms: settings },
			update: { sms: settings },
		});

		this.logger.log({
			message: "SMS settings changed",
			disclosureMode: settings.disclosureMode,
			autoSend: settings.autoSend,
			brandName: settings.brandName,
			licensedStates: settings.licensedStates,
		});

		return this.sms();
	}

	async calendar(): Promise<CalendarSettingsResult> {
		const [row, accounts] = await Promise.all([
			this.db.appSetting.findUnique({
				where: { id: SETTINGS_ID },
				select: { calendar: true },
			}),
			this.db.account.findMany({
				where: { providerId: GOOGLE_PROVIDER_ID },
				orderBy: { createdAt: "asc" },
				select: {
					userId: true,
					user: { select: { name: true, email: true } },
				},
			}),
		]);
		const settings = parseCalendarSettings(row?.calendar);
		const people = [
			...new Map(
				accounts.map((account) => [
					account.userId,
					{
						userId: account.userId,
						name: account.user.name,
						email: account.user.email,
					},
				]),
			).values(),
		];

		return {
			settings,
			accounts: people,
			effectiveOwnerUserId: settings.ownerUserId ?? people[0]?.userId ?? null,
		};
	}

	async setCalendar(
		settings: CalendarSettings,
	): Promise<CalendarSettingsResult> {
		if (settings.ownerUserId) {
			const connected = await this.db.account.findFirst({
				where: {
					providerId: GOOGLE_PROVIDER_ID,
					userId: settings.ownerUserId,
				},
				select: { id: true },
			});
			if (!connected) {
				throw new BadRequestException(
					"That person has not connected a Google account.",
				);
			}
		}

		await this.db.appSetting.upsert({
			where: { id: SETTINGS_ID },
			create: { id: SETTINGS_ID, calendar: settings },
			update: { calendar: settings },
		});

		this.logger.log({
			message: "Calendar settings changed",
			ownerUserId: settings.ownerUserId,
			hasFallbackLink: settings.fallbackBookingLink !== null,
		});

		return this.calendar();
	}

	complianceLimits(): ComplianceLimitsResult {
		return {
			frequency: {
				perDay: COMPLIANCE.frequency.day.max,
				perWeek: COMPLIANCE.frequency.week.max,
			},
		};
	}

	quietHours(): QuietHoursResult {
		return { rows: quietHoursTable() };
	}
}
