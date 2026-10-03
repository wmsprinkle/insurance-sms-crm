import { Inject } from "@nestjs/common";
import { Input, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	todayLeadInput,
	todayLeadOutput,
	todayLeadsInput,
	todayLeadsOutput,
	todayMeetingsOutput,
	todaySummaryOutput,
} from "./today.contracts";
import { TodayService } from "./today.service";

@Router({ alias: "today" })
@UseMiddlewares(AuthMiddleware)
export class TodayRouter {
	constructor(@Inject(TodayService) private readonly today: TodayService) {}

	@Query({
		output: todaySummaryOutput,
		meta: restMeta("GET", "/today/summary", ["Today"]),
	})
	async summary() {
		return this.today.summary();
	}

	@Query({
		output: todayMeetingsOutput,
		meta: restMeta("GET", "/today/meetings", ["Today"]),
	})
	async meetings() {
		return this.today.meetings();
	}

	@Query({
		input: todayLeadsInput,
		output: todayLeadsOutput,
		meta: restMeta("GET", "/today/leads", ["Today"]),
	})
	async leads(@Input() input: z.infer<typeof todayLeadsInput>) {
		return this.today.leads(input);
	}

	@Query({
		input: todayLeadInput,
		output: todayLeadOutput,
		meta: restMeta("GET", "/today/leads/{contactId}", ["Today"]),
	})
	async lead(@Input() input: z.infer<typeof todayLeadInput>) {
		return this.today.lead(input.contactId);
	}
}
