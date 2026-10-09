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
import { sendingStateOutput, setSendingInput } from "./sending.contracts";
import { SendingSwitchService } from "./sending-switch.service";
import {
	smsAgentSessionOutput,
	smsMarkHandledOutput,
	smsThreadInput,
	smsThreadListInput,
	smsThreadListOutput,
	smsThreadOutput,
} from "./sms-threads.contracts";
import { SmsThreadsService } from "./sms-threads.service";

@Router({ alias: "sms" })
@UseMiddlewares(AuthMiddleware)
export class SmsRouter {
	constructor(
		@Inject(SmsThreadsService) private readonly threads: SmsThreadsService,
		@Inject(SendingSwitchService)
		private readonly sending: SendingSwitchService,
		@Inject(ComplianceAdminService)
		private readonly admin: ComplianceAdminService,
	) {}

	@Query({
		output: sendingStateOutput,
		meta: restMeta("GET", "/sms/sending", ["SMS"]),
	})
	async sendingState() {
		return this.sending.state();
	}

	@Mutation({
		input: setSendingInput,
		output: sendingStateOutput,
		meta: restMeta("PATCH", "/sms/sending", ["SMS"]),
	})
	async setSending(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setSendingInput>,
	) {
		await this.admin.require(ctx.user.id, "complianceSettings");
		const state = await this.sending.set(input.live);
		await this.admin.record(ctx.user.id, "smsSendingChanged", {
			live: state.live,
		});
		return state;
	}

	@Query({
		input: smsThreadListInput,
		output: smsThreadListOutput,
		meta: restMeta("GET", "/sms/threads", ["SMS"]),
	})
	async threadList(@Input() input: z.infer<typeof smsThreadListInput>) {
		return this.threads.list(input);
	}

	@Query({
		input: smsThreadInput,
		output: smsThreadOutput,
		meta: restMeta("GET", "/sms/threads/{contactId}", ["SMS"]),
	})
	async thread(@Input() input: z.infer<typeof smsThreadInput>) {
		return this.threads.thread(input);
	}

	@Query({
		input: smsThreadInput,
		output: smsAgentSessionOutput,
		meta: restMeta("GET", "/sms/threads/{contactId}/agent-sessions", ["SMS"]),
	})
	async agentSessions(@Input() input: z.infer<typeof smsThreadInput>) {
		return this.threads.agentSessions(input);
	}

	@Mutation({
		input: smsThreadInput,
		output: smsMarkHandledOutput,
		meta: restMeta("POST", "/sms/threads/{contactId}/handled", ["SMS"]),
	})
	async markHandled(@Input() input: z.infer<typeof smsThreadInput>) {
		return this.threads.markHandled(input);
	}
}
