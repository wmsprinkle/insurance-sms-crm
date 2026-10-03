import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	smsSendTestFirstMessageInput,
	smsSendTestFirstMessageOutput,
	smsSimulateInboundInput,
	smsSimulateInboundOutput,
} from "./simulate.contracts";
import { SmsSimulateService } from "./simulate.service";
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
		@Inject(SmsSimulateService) private readonly simulate: SmsSimulateService,
	) {}

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

	@Mutation({
		input: smsSimulateInboundInput,
		output: smsSimulateInboundOutput,
		meta: restMeta("POST", "/sms/threads/{contactId}/simulate-inbound", [
			"SMS",
		]),
	})
	async simulateInbound(
		@Input() input: z.infer<typeof smsSimulateInboundInput>,
	) {
		return this.simulate.simulateInbound(input);
	}

	@Mutation({
		input: smsSendTestFirstMessageInput,
		output: smsSendTestFirstMessageOutput,
		meta: restMeta("POST", "/sms/threads/{contactId}/test-first-message", [
			"SMS",
		]),
	})
	async sendTestFirstMessage(
		@Input() input: z.infer<typeof smsSendTestFirstMessageInput>,
	) {
		return this.simulate.sendTestFirstMessage(input);
	}
}
