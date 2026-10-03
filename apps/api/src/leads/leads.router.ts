import { Inject } from "@nestjs/common";
import { Input, Mutation, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import { LeadImportService } from "./lead-import.service";
import {
	leadImportCommitInput,
	leadImportOutput,
	leadImportPreviewInput,
} from "./leads.contracts";

@Router({ alias: "leads" })
@UseMiddlewares(AuthMiddleware)
export class LeadsRouter {
	constructor(
		@Inject(LeadImportService) private readonly imports: LeadImportService,
	) {}

	@Mutation({
		input: leadImportPreviewInput,
		output: leadImportOutput,
		meta: restMeta("POST", "/leads/import/preview", ["Leads"]),
	})
	async importPreview(@Input() input: z.infer<typeof leadImportPreviewInput>) {
		return this.imports.preview(input);
	}

	@Mutation({
		input: leadImportCommitInput,
		output: leadImportOutput,
		meta: restMeta("POST", "/leads/import/commit", ["Leads"]),
	})
	async importCommit(@Input() input: z.infer<typeof leadImportCommitInput>) {
		return this.imports.commit(input);
	}
}
