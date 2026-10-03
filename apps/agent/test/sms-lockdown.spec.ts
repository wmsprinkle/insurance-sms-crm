import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { assertResearchPurpose, purposeOf } from "../agent/lib/session-purpose";
import { SMS_AGENT } from "../agent/lib/sms-config";
import lockdown from "../agent/tools/sms_lockdown";

const AGENT_DIR = join(import.meta.dir, "../agent");

const FRAMEWORK_TOOLS = [
	"bash",
	"read_file",
	"write_file",
	"glob",
	"grep",
	"web_fetch",
	"web_search",
	"todo",
	"ask_question",
	"load_skill",
];

const NOT_TOOLS = new Set(["agent", "sms_lockdown"]);

const INPUTS = new Map(
	Object.entries({
		send_sms: { body: "hi" },
		classify_reply: { label: "opt_out" },
		opt_out_contact: { reason: "opt_out" },
		handoff_to_human: { reason: "claim" },
		book_meeting: { start: "2026-10-06T15:00:00.000Z" },
	}),
);

const context = (taskKind?: string) => ({
	session: {
		auth: {
			current: { attributes: taskKind ? { taskKind, contactId: "c1" } : {} },
			initiator: null,
		},
	},
});

type LockedTool = {
	description: string;
	execute: () => { ok: boolean; reason: string };
};

function resolve(event: "session.started" | "turn.started", taskKind?: string) {
	const handler = lockdown.events[event] as (
		event: never,
		ctx: ReturnType<typeof context>,
	) => Record<string, LockedTool> | null;
	return handler({} as never, context(taskKind));
}

describe("SMS tool lockdown", () => {
	it("classifies every authored tool, subagent and framework tool", () => {
		const authored = readdirSync(join(AGENT_DIR, "tools"))
			.filter((file) => file.endsWith(".ts"))
			.map((file) => file.slice(0, -3))
			.filter((name) => !NOT_TOOLS.has(name));
		const subagents = readdirSync(join(AGENT_DIR, "subagents"));
		const classified = new Set<string>([
			...SMS_AGENT.tools.allowed,
			...SMS_AGENT.tools.locked,
		]);

		for (const name of [...authored, ...subagents, ...FRAMEWORK_TOOLS]) {
			expect(classified.has(name)).toBe(true);
		}
	});

	it("never locks an allowed SMS tool", () => {
		const allowed = new Set<string>(SMS_AGENT.tools.allowed);
		for (const name of SMS_AGENT.tools.locked) {
			expect(allowed.has(name)).toBe(false);
		}
	});

	const ALL_TOOLS = [
		...readdirSync(join(AGENT_DIR, "tools"))
			.filter((file) => file.endsWith(".ts"))
			.map((file) => file.slice(0, -3))
			.filter((name) => !NOT_TOOLS.has(name)),
		...readdirSync(join(AGENT_DIR, "subagents")),
		...FRAMEWORK_TOOLS,
	];
	const ALLOWED = new Set<string>(SMS_AGENT.tools.allowed);

	it.each(Object.values(SMS_AGENT.taskKinds))(
		"stubs every tool off the SMS allowlist in a %p session",
		(kind) => {
			for (const event of ["session.started", "turn.started"] as const) {
				const tools = resolve(event, kind) ?? {};
				for (const name of ALL_TOOLS) {
					if (ALLOWED.has(name)) {
						expect(tools[name]).toBeUndefined();
						continue;
					}
					expect(tools[name]?.execute()).toEqual({
						ok: false,
						reason: SMS_AGENT.tools.lockedReason,
					});
				}
			}
		},
	);

	it.each([
		"web_fetch",
		"web_search",
		"search_crm",
		"read_crm_history",
		"set_field_value",
		"manage_fields",
		"bash",
		"agent_builder",
	])("locks %p in an SMS reply session", (name) => {
		expect(
			resolve("turn.started", SMS_AGENT.taskKinds.reply)?.[name],
		).toBeDefined();
	});

	it.each(SMS_AGENT.tools.allowed.filter((name) => name !== "load_skill"))(
		"%p takes no contact from the model and refuses outside an SMS session",
		async (name) => {
			const tool = (await import(`../agent/tools/${name}.ts`)).default as {
				inputSchema: { shape: Record<string, never> };
				execute: (
					input: Record<string, never>,
					ctx: ReturnType<typeof context> & { callId: string },
				) => Promise<{ ok?: boolean; recorded?: boolean }>;
			};
			const keys = Object.keys(tool.inputSchema.shape);
			for (const key of keys) {
				expect(key).not.toMatch(/contact|phone|^to$|e164|task/i);
			}

			const input = (INPUTS.get(name) ?? {}) as Record<string, never>;
			const result = await tool.execute(input, { ...context(), callId: "c" });
			expect(result.ok === false || result.recorded === false).toBe(true);
		},
	);

	it("leaves the SMS tools callable", () => {
		const tools = resolve("session.started", SMS_AGENT.taskKinds.reply) ?? {};
		for (const name of SMS_AGENT.tools.allowed) {
			expect(tools[name]).toBeUndefined();
		}
	});

	it("locks follow-up and first-touch sessions too", () => {
		expect(resolve("session.started", SMS_AGENT.taskKinds.followUp)).not.toBe(
			null,
		);
		expect(resolve("session.started", SMS_AGENT.taskKinds.firstTouch)).not.toBe(
			null,
		);
	});

	it("changes nothing outside SMS sessions", () => {
		expect(resolve("session.started")).toBe(null);
		expect(resolve("session.started", "research")).toBe(null);
	});

	it("gives SMS sessions their own purpose so research writes refuse", () => {
		const sms = context(SMS_AGENT.taskKinds.reply);
		expect(purposeOf(sms)).toBe("sms");
		expect(() => assertResearchPurpose(sms)).toThrow();
		expect(purposeOf(context("research"))).toBe("research");
	});
});
