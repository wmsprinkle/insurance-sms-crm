import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import { ComplianceAdminService } from "../compliance/compliance-admin.service";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	smsComposeInput,
	smsDraftApproveInput,
	smsDraftDiscardOutput,
	smsDraftIdInput,
	smsDraftQueueOutput,
	smsHandBackInput,
	smsHandBackOutput,
	smsSendOutcome,
} from "./drafts.contracts";
import { SmsDraftsService } from "./drafts.service";

@Router({ alias: "smsDrafts" })
@UseMiddlewares(AuthMiddleware)
export class SmsDraftsRouter {
	constructor(
		@Inject(SmsDraftsService) private readonly drafts: SmsDraftsService,
		@Inject(ComplianceAdminService)
		private readonly admin: ComplianceAdminService,
	) {}

	@Query({
		output: smsDraftQueueOutput,
		meta: restMeta("GET", "/sms/drafts", ["SMS"]),
	})
	async queue() {
		return this.drafts.queue();
	}

	@Mutation({
		input: smsDraftApproveInput,
		output: smsSendOutcome,
		meta: restMeta("POST", "/sms/drafts/{draftId}/approve", ["SMS"]),
	})
	async approve(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof smsDraftApproveInput>,
	) {
		await this.admin.require(ctx.user.id, "smsSend");
		return this.drafts.approve(input, ctx.user.id);
	}

	@Mutation({
		input: smsDraftIdInput,
		output: smsDraftDiscardOutput,
		meta: restMeta("POST", "/sms/drafts/{draftId}/discard", ["SMS"]),
	})
	async discard(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof smsDraftIdInput>,
	) {
		await this.admin.require(ctx.user.id, "smsSend");
		return this.drafts.discard(input, ctx.user.id);
	}

	@Mutation({
		input: smsHandBackInput,
		output: smsHandBackOutput,
		meta: restMeta("POST", "/sms/handoffs/{contactId}/hand-back", ["SMS"]),
	})
	async handBack(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof smsHandBackInput>,
	) {
		await this.admin.require(ctx.user.id, "smsSend");
		return this.drafts.handBack(input);
	}

	@Mutation({
		input: smsComposeInput,
		output: smsSendOutcome,
		meta: restMeta("POST", "/sms/threads/{contactId}/send", ["SMS"]),
	})
	async compose(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof smsComposeInput>,
	) {
		await this.admin.require(ctx.user.id, "smsSend");
		return this.drafts.compose(input);
	}
}
