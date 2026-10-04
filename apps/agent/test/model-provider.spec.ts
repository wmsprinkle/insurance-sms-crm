import { describe, expect, it } from "bun:test";
import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";
import {
	anthropicKey,
	directModel,
	fallbackModel,
	nativeAnthropicId,
} from "../agent/lib/model";
import { ANTHROPIC } from "../agent/lib/model-config";

const KEYED = { ANTHROPIC_API_KEY: "sk-test" };

describe("model provider selection", () => {
	it("uses the gateway when no Anthropic key is set", () => {
		expect(fallbackModel({})).toBe(DEFAULT_AGENT_MODEL.id);
		expect(fallbackModel({ ANTHROPIC_API_KEY: "  " })).toBe(
			DEFAULT_AGENT_MODEL.id,
		);
		expect(directModel("anthropic/claude-sonnet-4.5", {})).toBeNull();
		expect(anthropicKey({})).toBeNull();
	});

	it("uses the Anthropic provider when the key is set", () => {
		expect(fallbackModel(KEYED)).not.toBeString();
		const model = directModel(ANTHROPIC.defaultModelId, KEYED);

		if (!model) throw new Error("expected a direct model");
		expect(model.provider).toStartWith("anthropic");
		expect(model.modelId).toBe(ANTHROPIC.defaultModelId);
	});

	it("maps gateway ids to native ids and falls back to the default", () => {
		expect(nativeAnthropicId("anthropic/claude-sonnet-4.5")).toBe(
			"claude-sonnet-4-5",
		);
		expect(nativeAnthropicId("zai/glm-5.2-fast")).toBe(
			ANTHROPIC.defaultModelId,
		);
	});

	it("sends the workspace header only when the id is set", async () => {
		const seen: Array<Headers> = [];
		const original = globalThis.fetch;
		globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
			seen.push(new Headers(init?.headers));
			return new Response("{}", { status: 400 });
		}) as unknown as typeof fetch;

		try {
			for (const env of [
				KEYED,
				{ ...KEYED, ANTHROPIC_WORKSPACE_ID: "wrkspc_1" },
			]) {
				const model = directModel(ANTHROPIC.defaultModelId, env);
				await model
					?.doGenerate({
						prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
					})
					.catch(() => undefined);
			}
		} finally {
			globalThis.fetch = original;
		}

		expect(seen).toHaveLength(2);
		expect(seen[0]?.get(ANTHROPIC.workspaceHeader)).toBeNull();
		expect(seen[1]?.get(ANTHROPIC.workspaceHeader)).toBe("wrkspc_1");
	});
});
