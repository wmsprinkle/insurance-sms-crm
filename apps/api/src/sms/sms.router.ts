import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
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

	@Mutation({
		input: smsThreadInput,
		output: smsMarkHandledOutput,
		meta: restMeta("POST", "/sms/threads/{contactId}/handled", ["SMS"]),
	})
	async markHandled(@Input() input: z.infer<typeof smsThreadInput>) {
		return this.threads.markHandled(input);
	}
}
