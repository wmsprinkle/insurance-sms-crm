import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	agentModelOutput,
	archiveRetentionOutput,
	modelCatalogOutput,
	quietHoursOutput,
	researchKeyOutput,
	setAgentModelInput,
	setArchiveRetentionDaysInput,
	setResearchKeyInput,
	setSmsSettingsInput,
	smsSettingsOutput,
} from "./settings.contracts";
import { SettingsService } from "./settings.service";

@Router({ alias: "settings" })
@UseMiddlewares(AuthMiddleware)
export class SettingsRouter {
	constructor(
		@Inject(SettingsService) private readonly settings: SettingsService,
	) {}

	@Query({
		output: agentModelOutput,
		meta: restMeta("GET", "/settings/agent-model", ["Settings"]),
	})
	async agentModel() {
		return this.settings.agentModel();
	}

	@Query({
		output: modelCatalogOutput,
		meta: restMeta("GET", "/settings/model-catalog", ["Settings"]),
	})
	async modelCatalog() {
		return this.settings.modelCatalog();
	}

	@Mutation({
		input: setAgentModelInput,
		output: agentModelOutput,
		meta: restMeta("PATCH", "/settings/agent-model", ["Settings"]),
	})
	async setAgentModel(@Input() input: z.infer<typeof setAgentModelInput>) {
		return this.settings.setAgentModel(input.modelId);
	}

	@Query({
		output: researchKeyOutput,
		meta: restMeta("GET", "/settings/research-key", ["Settings"]),
	})
	async researchKey() {
		return this.settings.researchKey();
	}

	@Mutation({
		input: setResearchKeyInput,
		output: researchKeyOutput,
		meta: restMeta("PATCH", "/settings/research-key", ["Settings"]),
	})
	async setResearchKey(@Input() input: z.infer<typeof setResearchKeyInput>) {
		return this.settings.setResearchKey(input.apiKey);
	}

	@Query({
		output: archiveRetentionOutput,
		meta: restMeta("GET", "/settings/archive-retention", ["Settings"]),
	})
	async archiveRetention() {
		return this.settings.archiveRetention();
	}

	@Mutation({
		input: setArchiveRetentionDaysInput,
		output: archiveRetentionOutput,
		meta: restMeta("PATCH", "/settings/archive-retention", ["Settings"]),
	})
	async setArchiveRetention(
		@Input() input: z.infer<typeof setArchiveRetentionDaysInput>,
	) {
		return this.settings.setArchiveRetention(input.days);
	}

	@Query({
		output: smsSettingsOutput,
		meta: restMeta("GET", "/settings/sms", ["Settings"]),
	})
	async sms() {
		return this.settings.sms();
	}

	@Mutation({
		input: setSmsSettingsInput,
		output: smsSettingsOutput,
		meta: restMeta("PATCH", "/settings/sms", ["Settings"]),
	})
	async setSms(@Input() input: z.infer<typeof setSmsSettingsInput>) {
		return this.settings.setSms(input);
	}

	@Query({
		output: quietHoursOutput,
		meta: restMeta("GET", "/settings/quiet-hours", ["Settings"]),
	})
	async quietHours() {
		return this.settings.quietHours();
	}
}
