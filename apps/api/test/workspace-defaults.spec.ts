import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { DEFAULT_WORKSPACE } from "../src/workspace/workspace.config";
import { WorkspaceService } from "../src/workspace/workspace.service";

const USER_ID = "workspace-defaults-user";

const realEnrichment = process.env.FEATURE_ENRICHMENT;

const trigger = new AgentTriggerService(db);
const service = new WorkspaceService(db, trigger);

async function clean() {
	await db.agentTask.deleteMany({ where: { kind: "workspace-profile" } });
	await db.member.deleteMany({});
	await db.organization.deleteMany({});
	await db.user.deleteMany({ where: { id: USER_ID } });
}

beforeEach(async () => {
	await clean();
	await db.user.create({
		data: { id: USER_ID, name: "Rep", email: "rep@example.com" },
	});
});

afterEach(async () => {
	await clean();
	if (realEnrichment === undefined) delete process.env.FEATURE_ENRICHMENT;
	else process.env.FEATURE_ENRICHMENT = realEnrichment;
});

describe("first sign-in", () => {
	it("creates a ready workspace with the default name and no form", async () => {
		const workspace = await service.get(USER_ID);

		expect(workspace.name).toBe(DEFAULT_WORKSPACE.name);
		expect(workspace.slug).toBe("my-insurance-agency");
		expect(workspace.onboarded).toBe(true);
		expect(workspace.viewerRole).toBe("owner");
	});

	it("keeps a name the owner chose later", async () => {
		await service.get(USER_ID);
		await service.update(USER_ID, { name: "Acme Insurance", website: "" });

		const workspace = await service.get(USER_ID);

		expect(workspace.name).toBe("Acme Insurance");
		expect(workspace.slug).toBe("acme-insurance");
	});

	it("saves a workspace with no website", async () => {
		await service.get(USER_ID);

		const saved = await service.update(USER_ID, { name: "A", website: "" });

		expect(saved.website).toBeNull();
	});
});

describe("the company profile task", () => {
	async function queued() {
		return db.agentTask.count({ where: { kind: "workspace-profile" } });
	}

	it("is not queued when enrichment is off", async () => {
		delete process.env.FEATURE_ENRICHMENT;
		await service.get(USER_ID);

		await service.update(USER_ID, { name: "A", website: "acme.com" });

		expect(await queued()).toBe(0);
	});

	it("is queued when enrichment is on", async () => {
		process.env.FEATURE_ENRICHMENT = "true";
		await service.get(USER_ID);

		await service.update(USER_ID, { name: "A", website: "acme.com" });

		expect(await queued()).toBe(1);
	});
});
