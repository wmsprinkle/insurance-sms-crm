import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_WORKSPACE_NAME, WORKSPACE_ID } from "@crm/auth";
import { db } from "@crm/db";
import { workspaceSlug } from "@crm/db/workspace";
import { ForbiddenException } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { ContactsService } from "../src/contacts/contacts.service";
import { AuthMiddleware } from "../src/trpc/middlewares/auth.middleware";
import {
	PROCEDURE_ROLES,
	requiredRoleOf,
	roleMeets,
} from "../src/trpc/procedure-roles";
import { WorkspaceService } from "../src/workspace/workspace.service";

const SRC = join(import.meta.dir, "..", "src");

function routerFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return routerFiles(path);
		return name.endsWith(".router.ts") ? [path] : [];
	});
}

type Found = { procedure: string; file: string; authenticated: boolean };

function mutationsOf(file: string): Found[] {
	const source = readFileSync(file, "utf8");
	const alias = /@Router\(\{\s*alias:\s*"([^"]+)"/.exec(source)?.[1];
	if (!alias) return [];

	const classGuarded = /@UseMiddlewares\([^)]*AuthMiddleware/.test(
		source.slice(0, source.indexOf("export class")),
	);
	const found: Found[] = [];
	const pattern =
		/@Mutation\((?:.|\n)*?\)\s*\n((?:\s*@UseMiddlewares\([^)]*\)\s*\n)?)\s*(?:async\s+)?(\w+)\s*\(/g;
	for (const match of source.matchAll(pattern)) {
		found.push({
			procedure: `${alias}.${match[2]}`,
			file,
			authenticated: classGuarded || /AuthMiddleware/.test(match[1] ?? ""),
		});
	}
	return found;
}

const mutations = routerFiles(SRC).flatMap(mutationsOf);

describe("every mutating tRPC procedure has a role class", () => {
	it("finds the mutations", () => {
		expect(mutations.length).toBeGreaterThan(100);
	});

	it("classifies each mutation", () => {
		const missing = mutations
			.filter((found) => requiredRoleOf(found.procedure) === null)
			.map((found) => found.procedure);

		expect(missing).toEqual([]);
	});

	it("keeps no class for a procedure that no longer exists", () => {
		const real = new Set(mutations.map((found) => found.procedure));
		const stale = Object.keys(PROCEDURE_ROLES).filter((key) => !real.has(key));

		expect(stale).toEqual([]);
	});

	it("runs the role check on each mutation, through the auth middleware", () => {
		const open = mutations
			.filter((found) => !found.authenticated)
			.map((found) => found.procedure);

		expect(open).toEqual([]);
	});

	it("keeps the sensitive procedures admin-only", () => {
		for (const procedure of [
			"settings.setAgentModel",
			"settings.setResearchKey",
			"settings.setSms",
			"settings.setArchiveRetention",
			"apiKeys.create",
			"agents.deploy",
			"contacts.purge",
			"contacts.bulkPurge",
			"leads.importCommit",
			"workspace.setMemberRole",
		]) {
			expect(requiredRoleOf(procedure)).toBe("admin");
		}
	});

	it("refuses an unknown path", () => {
		expect(requiredRoleOf("nope.nothing")).toBeNull();
		expect(requiredRoleOf("constructor")).toBeNull();
	});
});

describe("roleMeets", () => {
	it("orders member below admin below owner, and refuses no role", () => {
		expect(roleMeets("member", "member")).toBe(true);
		expect(roleMeets("member", "admin")).toBe(false);
		expect(roleMeets("admin", "admin")).toBe(true);
		expect(roleMeets("admin", "owner")).toBe(false);
		expect(roleMeets("owner", "admin")).toBe(true);
		expect(roleMeets(null, "member")).toBe(false);
	});
});

const suffix = process.env.TEST_RUN_ID ?? "procedure-roles-spec";
const ids = {
	owner: `owner-${suffix}`,
	admin: `admin-${suffix}`,
	member: `member-${suffix}`,
	stranger: `stranger-${suffix}`,
};
const memberRowOf = (key: keyof typeof ids) => `m-${ids[key]}`;

beforeAll(async () => {
	await db.member.deleteMany({ where: { userId: { in: Object.values(ids) } } });
	await db.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
	await db.organization.upsert({
		where: { id: WORKSPACE_ID },
		update: {},
		create: {
			id: WORKSPACE_ID,
			name: DEFAULT_WORKSPACE_NAME,
			slug: workspaceSlug(DEFAULT_WORKSPACE_NAME),
			createdAt: new Date(),
		},
	});
	for (const [key, userId] of Object.entries(ids)) {
		await db.user.create({
			data: { id: userId, name: key, email: `${userId}@example.test` },
		});
	}
	for (const key of ["owner", "admin", "member"] as const) {
		await db.member.create({
			data: {
				id: memberRowOf(key),
				organizationId: WORKSPACE_ID,
				userId: ids[key],
				role: key,
				createdAt: new Date(),
			},
		});
	}
});

afterAll(async () => {
	await db.member.deleteMany({ where: { userId: { in: Object.values(ids) } } });
	await db.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
});

function runMiddleware(userId: string | null, path: string, type: string) {
	const middleware = new AuthMiddleware();
	let reached = false;
	const opts = {
		ctx: { session: userId ? { user: { id: userId } } : null },
		type,
		path,
		next: () => {
			reached = true;
			return {};
		},
	};
	const result = middleware.use(
		opts as unknown as Parameters<AuthMiddleware["use"]>[0],
	);
	return { result, reached: () => reached };
}

describe("AuthMiddleware enforces the role class on mutations", () => {
	it("lets a member run a member mutation", async () => {
		const run = runMiddleware(ids.member, "contacts.archive", "mutation");
		await run.result;
		expect(run.reached()).toBe(true);
	});

	it.each([
		"settings.setAgentModel",
		"settings.setResearchKey",
		"apiKeys.create",
		"agents.deploy",
		"contacts.purge",
	])("refuses a member on %s", async (path) => {
		const run = runMiddleware(ids.member, path, "mutation");
		await expect(run.result).rejects.toBeInstanceOf(TRPCError);
		expect(run.reached()).toBe(false);
	});

	it.each(["admin", "owner"] as const)(
		"lets an %s run admin mutations",
		async (key) => {
			const run = runMiddleware(
				ids[key],
				"settings.setResearchKey",
				"mutation",
			);
			await run.result;
			expect(run.reached()).toBe(true);
		},
	);

	it("refuses a signed-in user who is not in the workspace", async () => {
		const run = runMiddleware(ids.stranger, "contacts.archive", "mutation");
		await expect(run.result).rejects.toBeInstanceOf(TRPCError);
	});

	it("refuses a mutation with no class, even for an owner", async () => {
		const run = runMiddleware(ids.owner, "invented.mutation", "mutation");
		await expect(run.result).rejects.toBeInstanceOf(TRPCError);
		expect(run.reached()).toBe(false);
	});

	it("does not role-check a query", async () => {
		const run = runMiddleware(ids.member, "settings.get", "query");
		await run.result;
		expect(run.reached()).toBe(true);
	});

	it("still refuses a missing session", async () => {
		const run = runMiddleware(null, "contacts.archive", "mutation");
		await expect(run.result).rejects.toBeInstanceOf(TRPCError);
	});
});

describe("owner escalation", () => {
	const workspace = new WorkspaceService(
		db,
		{} as unknown as AgentTriggerService,
	);

	it("refuses an admin who makes a member an owner", async () => {
		await expect(
			workspace.setMemberRole(ids.admin, {
				memberId: memberRowOf("member"),
				role: "owner",
			}),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("refuses an admin who makes themselves an owner", async () => {
		await expect(
			workspace.setMemberRole(ids.admin, {
				memberId: memberRowOf("admin"),
				role: "owner",
			}),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("refuses an admin who demotes an owner", async () => {
		await expect(
			workspace.setMemberRole(ids.admin, {
				memberId: memberRowOf("owner"),
				role: "member",
			}),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("lets an admin change a member to admin", async () => {
		const updated = await workspace.setMemberRole(ids.admin, {
			memberId: memberRowOf("member"),
			role: "admin",
		});
		expect(updated.role).toBe("admin");
		await workspace.setMemberRole(ids.owner, {
			memberId: memberRowOf("member"),
			role: "member",
		});
	});

	it("lets an owner make a member an owner", async () => {
		const updated = await workspace.setMemberRole(ids.owner, {
			memberId: memberRowOf("member"),
			role: "owner",
		});
		expect(updated.role).toBe("owner");
		await workspace.setMemberRole(ids.owner, {
			memberId: memberRowOf("member"),
			role: "member",
		});
	});
});

describe("contact phone edits", () => {
	const contactId = `contact-${suffix}`;
	const service = Object.assign(Object.create(ContactsService.prototype), {
		db,
	}) as {
		requireAdminForPhoneChange(
			id: string,
			phone: string,
			userId: string,
		): Promise<void>;
	};

	beforeAll(async () => {
		await db.contact.deleteMany({ where: { id: contactId } });
		await db.contact.create({
			data: { id: contactId, firstName: "Phone", phone: "+12125550123" },
		});
	});

	afterAll(async () => {
		await db.contact.deleteMany({ where: { id: contactId } });
	});

	it("refuses a member who changes the number", async () => {
		await expect(
			service.requireAdminForPhoneChange(contactId, "+12125550999", ids.member),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("lets a member resend the same number", async () => {
		await service.requireAdminForPhoneChange(
			contactId,
			"(212) 555-0123",
			ids.member,
		);
	});

	it("lets an admin change the number", async () => {
		await service.requireAdminForPhoneChange(
			contactId,
			"+12125550999",
			ids.admin,
		);
	});
});
