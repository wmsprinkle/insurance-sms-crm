import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import { BadRequestException } from "@nestjs/common";
import { COMPLIANCE } from "../src/compliance/compliance-config";
import { SettingsService } from "../src/settings/settings.service";
import { readBrand } from "../src/sms/sms-brand";
import { SmsThreadsService } from "../src/sms/sms-threads.service";

type Seed = {
	calendar?: unknown;
	sms?: unknown;
	workspace?: string | null;
	accounts?: { userId: string; name: string; email: string }[];
};

function fakeDb(seed: Seed) {
	const written = new Map<string, unknown>();
	const db = {
		appSetting: {
			findUnique: async () => ({
				calendar: seed.calendar ?? null,
				sms: seed.sms ?? null,
			}),
			upsert: async ({ update }: { update: { calendar: unknown } }) => {
				written.set("calendar", update.calendar);
				seed.calendar = update.calendar;
			},
		},
		organization: {
			findUnique: async () =>
				seed.workspace === undefined ? null : { name: seed.workspace },
		},
		account: {
			findMany: async () =>
				(seed.accounts ?? []).map((account) => ({
					userId: account.userId,
					user: { name: account.name, email: account.email },
				})),
			findFirst: async ({ where }: { where: { userId: string } }) =>
				(seed.accounts ?? []).find((account) => account.userId === where.userId)
					? { id: "a1" }
					: null,
		},
	} as unknown as Db;
	return { db, written };
}

function settingsService(db: Db) {
	return new SettingsService(db, {} as never, {} as never, {} as never);
}

const ANA = { userId: "u1", name: "Ana", email: "ana@agency.test" };
const BEN = { userId: "u2", name: "Ben", email: "ben@agency.test" };

describe("settings.calendar", () => {
	it("lists the connected Google accounts and defaults the owner to the first", async () => {
		const { db } = fakeDb({ accounts: [ANA, BEN] });
		const result = await settingsService(db).calendar();

		expect(result.accounts.map((person) => person.userId)).toEqual([
			"u1",
			"u2",
		]);
		expect(result.settings).toEqual({
			ownerUserId: null,
			fallbackBookingLink: null,
		});
		expect(result.effectiveOwnerUserId).toBe("u1");
	});

	it("shows one row per user with several Google accounts", async () => {
		const { db } = fakeDb({ accounts: [ANA, ANA] });
		const result = await settingsService(db).calendar();

		expect(result.accounts).toHaveLength(1);
	});

	it("saves the owner and the fallback link", async () => {
		const { db, written } = fakeDb({ accounts: [ANA, BEN] });
		const result = await settingsService(db).setCalendar({
			ownerUserId: "u2",
			fallbackBookingLink: "https://cal.example.com/agency",
		});

		expect(written.get("calendar")).toEqual({
			ownerUserId: "u2",
			fallbackBookingLink: "https://cal.example.com/agency",
		});
		expect(result.effectiveOwnerUserId).toBe("u2");
	});

	it("refuses an owner without a connected Google account", async () => {
		const { db, written } = fakeDb({ accounts: [ANA] });

		await expect(
			settingsService(db).setCalendar({
				ownerUserId: "u9",
				fallbackBookingLink: null,
			}),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(written.has("calendar")).toBe(false);
	});

	it("clears the owner with null", async () => {
		const { db } = fakeDb({
			accounts: [ANA],
			calendar: { ownerUserId: "u1", fallbackBookingLink: null },
		});
		const result = await settingsService(db).setCalendar({
			ownerUserId: null,
			fallbackBookingLink: null,
		});

		expect(result.settings.ownerUserId).toBeNull();
	});
});

describe("settings.complianceLimits", () => {
	it("reads the frequency cap from the compliance config", () => {
		const { db } = fakeDb({});

		expect(settingsService(db).complianceLimits()).toEqual({
			frequency: {
				perDay: COMPLIANCE.frequency.day.max,
				perWeek: COMPLIANCE.frequency.week.max,
			},
		});
	});
});

describe("readBrand", () => {
	it("prefers the brand name setting", async () => {
		const { db } = fakeDb({
			sms: { brandName: " Acme Life " },
			workspace: "W",
		});

		expect(await readBrand(db)).toBe("Acme Life");
	});

	it("falls back to the workspace name, then a fixed name", async () => {
		expect(await readBrand(fakeDb({ workspace: "Workspace" }).db)).toBe(
			"Workspace",
		);
		expect(await readBrand(fakeDb({}).db)).toBe("Our team");
	});

	it("ignores an unreadable stored brand name", async () => {
		const { db } = fakeDb({ sms: { brandName: 7 }, workspace: "Workspace" });

		expect(await readBrand(db)).toBe("Workspace");
	});
});

describe("smsThreads.agentSessions", () => {
	it("returns the events of the contact's SMS session only", async () => {
		const seen = new Map<string, unknown>();
		const emitted = (minute: number) =>
			new Date(Date.UTC(2026, 9, 3, 15, minute));
		const db = {
			agentEvent: {
				findMany: async (args: { where: unknown }) => {
					seen.set("where", args.where);
					return [
						{
							id: "e2",
							sessionId: "crm:sms:c1",
							type: "message.completed",
							data: {},
							emittedAt: emitted(2),
						},
						{
							id: "e1",
							sessionId: "crm:sms:c1",
							type: "session.started",
							data: {},
							emittedAt: emitted(1),
						},
					];
				},
			},
		} as unknown as Db;

		const result = await new SmsThreadsService(db).agentSessions({
			contactId: "c1",
		});

		expect(seen.get("where")).toEqual({ sessionId: { endsWith: "sms:c1" } });
		expect(result.truncated).toBe(false);
		expect(result.sessions).toHaveLength(1);
		expect(result.sessions[0]?.events.map((event) => event.meta.id)).toEqual([
			"e1",
			"e2",
		]);
	});
});
