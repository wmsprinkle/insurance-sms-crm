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
		return this.drafts.discard(input, ctx.user.id);
	}

	@Mutation({
		input: smsHandBackInput,
		output: smsHandBackOutput,
		meta: restMeta("POST", "/sms/handoffs/{contactId}/hand-back", ["SMS"]),
	})
	async handBack(@Input() input: z.infer<typeof smsHandBackInput>) {
		return this.drafts.handBack(input);
	}

	@Mutation({
		input: smsComposeInput,
		output: smsSendOutcome,
		meta: restMeta("POST", "/sms/threads/{contactId}/send", ["SMS"]),
	})
	async compose(@Input() input: z.infer<typeof smsComposeInput>) {
		return this.drafts.compose(input);
	}
}
