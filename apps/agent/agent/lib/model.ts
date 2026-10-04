import "@crm/env/load";

import { createAnthropic } from "@ai-sdk/anthropic";
import { db } from "@crm/db";
import { DEFAULT_AGENT_MODEL, readAgentModel } from "@crm/db/settings";
import { type AgentModelDefinition, defineDynamic } from "eve";
import { ANTHROPIC } from "./model-config";

export interface ModelSelection {
	model: string;
	modelContextWindowTokens: number;
}

type Env = Readonly<Record<string, string | undefined>>;

export type DirectModel = ReturnType<ReturnType<typeof createAnthropic>>;

function present(value: string | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export function anthropicKey(env: Env = process.env): string | null {
	return present(env[ANTHROPIC.keyVariable]);
}

export function nativeAnthropicId(id: string): string {
	if (!id.startsWith(ANTHROPIC.gatewayPrefix)) {
		return ANTHROPIC.defaultModelId;
	}
	return id.slice(ANTHROPIC.gatewayPrefix.length).replaceAll(".", "-");
}

export function directModel(
	id: string,
	env: Env = process.env,
): DirectModel | null {
	const apiKey = anthropicKey(env);
	if (!apiKey) return null;

	const workspaceId = present(env[ANTHROPIC.workspaceVariable]);

	return createAnthropic({
		apiKey,
		headers: workspaceId ? { [ANTHROPIC.workspaceHeader]: workspaceId } : {},
	})(nativeAnthropicId(id));
}

export function fallbackModel(env: Env = process.env): string | DirectModel {
	return directModel(ANTHROPIC.defaultModelId, env) ?? DEFAULT_AGENT_MODEL.id;
}

export async function selectedModel(): Promise<ModelSelection | null> {
	try {
		const setting = await readAgentModel(db);

		if (setting.isDefault) return null;

		return {
			model: setting.id,
			modelContextWindowTokens: setting.contextWindowTokens,
		};
	} catch (error) {
		console.error(
			`[agent] could not read the configured model, falling back: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return null;
	}
}

export function modelDefinition<Ctx>(
	pick: (ctx: Ctx) => Promise<ModelSelection | null>,
	env: Env = process.env,
): AgentModelDefinition {
	const fallback = directModel(ANTHROPIC.defaultModelId, env);

	if (!fallback) {
		return defineDynamic({
			fallback: DEFAULT_AGENT_MODEL.id,
			events: { "session.started": (_event, ctx) => pick(ctx as Ctx) },
		});
	}

	return defineDynamic({
		fallback,
		events: {
			"step.started": async (_event, ctx) => {
				const selection = await pick(ctx as Ctx);
				if (!selection) return null;

				const model = directModel(selection.model, env);
				if (!model) return null;

				return {
					model,
					modelContextWindowTokens: selection.modelContextWindowTokens,
				};
			},
		},
	});
}
