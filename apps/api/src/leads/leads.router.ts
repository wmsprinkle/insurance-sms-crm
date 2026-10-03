import { Inject } from "@nestjs/common";
import { Ctx, Input, Mutation, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { ComplianceAdminService } from "../compliance/compliance-admin.service";
import type { AuthedTrpcContext } from "../trpc/context.types";
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
		@Inject(ComplianceAdminService)
		private readonly admin: ComplianceAdminService,
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
	async importCommit(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof leadImportCommitInput>,
	) {
		await this.admin.require(ctx.user.id, "leadImport");
		const result = await this.imports.commit(input);
		await this.admin.record(ctx.user.id, "leadsImported", {
			totals: result.totals,
		});
		return result;
	}
}
