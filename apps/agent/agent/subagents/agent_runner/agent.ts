import { db } from "@crm/db";
import { defineAgent } from "eve";
import { z } from "zod";
import { type ModelSelection, modelDefinition } from "../../lib/model";
import { attribute, purposeOf } from "../../lib/session-purpose";

type RunContext = Parameters<typeof purposeOf>[0];

async function runModel(ctx: RunContext): Promise<ModelSelection | null> {
	if (purposeOf(ctx) !== "team-agent") return null;
	const runId = attribute(ctx, "runId");
	if (!runId) return null;

	const run = await db.agentRun.findUnique({
		where: { id: runId },
		select: {
			version: {
				select: { modelId: true, modelContextWindowTokens: true },
			},
		},
	});
	return run
		? {
				model: run.version.modelId,
				modelContextWindowTokens: run.version.modelContextWindowTokens,
			}
		: null;
}

export default defineAgent({
	description:
		"Execute one immutable deployed CRM agent version and persist its result and every side effect.",
	model: modelDefinition(runModel),
	outputSchema: z.object({
		summary: z.string().min(1).max(1000),
		result: z.record(z.string(), z.unknown()).nullable(),
	}),
	limits: {
		maxInputTokensPerSession: 500_000,
		maxOutputTokensPerSession: 40_000,
		sessionTimeoutMs: 24 * 60 * 60 * 1000,
	},
});
