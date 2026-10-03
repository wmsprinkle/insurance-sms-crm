import { describe, expect, it } from "bun:test";
import { DealStage } from "@crm/db/enums";
import {
	type CrmEvent,
	type LeadContact,
	type LeadDeal,
	type LeadDealDb,
	moveLeadDeal,
} from "../agent/lib/sms-deal";

const NOW = new Date("2026-10-05T14:00:00.000Z");

type Fake = {
	db: LeadDealDb;
	deals: LeadDeal[];
	events: CrmEvent[];
	companies: string[];
	locks: string[];
	links: { dealId: string; contactId: string }[];
};

function fakeDeals(input: {
	contact?: LeadContact | null;
	deals?: LeadDeal[];
	owner?: string | null;
}): Fake {
	const fake: Omit<Fake, "db"> = {
		deals: [...(input.deals ?? [])],
		events: [],
		companies: [],
		locks: [],
		links: [],
	};
	const contact =
		input.contact === undefined
			? {
					id: "c1",
					firstName: "Dana",
					lastName: "Reyes",
					companyId: null,
					ownerId: null,
				}
			: input.contact;

	const db: LeadDealDb = {
		lock: async (contactId) => {
			fake.locks.push(contactId);
		},
		contact: async () => contact,
		deals: async () => fake.deals,
		defaultOwnerId: async () =>
			input.owner === undefined ? "u-owner" : input.owner,
		householdCompany: async (lead) => {
			const id = `co${fake.companies.length + 1}`;
			fake.companies.push(`${lead.firstName} household`);
			return id;
		},
		createDeal: async ({ name, companyId, ownerId, stage, contactId }) => {
			const deal = {
				id: `d${fake.deals.length + 1}`,
				stage,
				companyId,
				ownerId,
			};
			fake.deals.push(deal);
			fake.links.push({ dealId: deal.id, contactId });
			expect(name).toContain("Dana Reyes");
			return deal;
		},
		moveDeal: async (deal, stage) => {
			const stored = fake.deals.find((entry) => entry.id === deal.id);
			if (stored) stored.stage = stage;
		},
		emit: async (event) => {
			fake.events.push(event);
		},
	};
	return Object.assign(fake, { db });
}

const OPEN: LeadDeal = {
	id: "d-open",
	stage: DealStage.QUALIFIED_TO_BUY,
	companyId: "co-x",
	ownerId: "u-x",
};

describe("moveLeadDeal", () => {
	it("creates and links a deal for an SMS lead with none", async () => {
		const fake = fakeDeals({});

		const move = await moveLeadDeal(
			"c1",
			DealStage.QUALIFIED_TO_BUY,
			fake.db,
			NOW,
		);

		expect(move).toEqual({ created: "d1", moved: [], skipped: null });
		expect(fake.links).toEqual([{ dealId: "d1", contactId: "c1" }]);
		expect(fake.companies).toHaveLength(1);
		expect(fake.locks).toEqual(["c1"]);
		expect(fake.events).toEqual([
			{
				type: "deal.created",
				dealId: "d1",
				occurredAt: NOW,
				data: { companyId: "co1", stage: DealStage.QUALIFIED_TO_BUY },
			},
		]);
	});

	it("reuses the contact's own company and owner", async () => {
		const fake = fakeDeals({
			contact: {
				id: "c1",
				firstName: "Dana",
				lastName: "Reyes",
				companyId: "co-own",
				ownerId: "u-rep",
			},
		});

		await moveLeadDeal("c1", DealStage.DEMO_BOOKED, fake.db, NOW);

		expect(fake.companies).toHaveLength(0);
		expect(fake.deals[0]).toMatchObject({
			companyId: "co-own",
			ownerId: "u-rep",
			stage: DealStage.DEMO_BOOKED,
		});
	});

	it("does not open a deal only to close it", async () => {
		const fake = fakeDeals({});

		expect(
			await moveLeadDeal("c1", DealStage.UNQUALIFIED_TO_BUY, fake.db, NOW),
		).toEqual({ created: null, moved: [], skipped: null });
		expect(fake.deals).toHaveLength(0);
	});

	it("skips creation when no user can own the deal", async () => {
		const fake = fakeDeals({ owner: null });

		expect(
			(await moveLeadDeal("c1", DealStage.QUALIFIED_TO_BUY, fake.db, NOW))
				.skipped,
		).toBe("no-owner");
	});

	it("moves an open deal forward and emits the stage change", async () => {
		const fake = fakeDeals({ deals: [{ ...OPEN }] });

		const move = await moveLeadDeal("c1", DealStage.DEMO_BOOKED, fake.db, NOW);

		expect(move.moved).toEqual(["d-open"]);
		expect(fake.deals[0]?.stage).toBe(DealStage.DEMO_BOOKED);
		expect(fake.events).toEqual([
			{
				type: "deal.stage.changed",
				dealId: "d-open",
				occurredAt: NOW,
				data: {
					companyId: "co-x",
					from: DealStage.QUALIFIED_TO_BUY,
					to: DealStage.DEMO_BOOKED,
				},
			},
		]);
	});

	it("never moves a booked deal back to qualified", async () => {
		const fake = fakeDeals({
			deals: [{ ...OPEN, stage: DealStage.DEMO_BOOKED }],
		});

		const move = await moveLeadDeal(
			"c1",
			DealStage.QUALIFIED_TO_BUY,
			fake.db,
			NOW,
		);

		expect(move.moved).toEqual([]);
		expect(fake.events).toHaveLength(0);
	});

	it("emits deal.closed when a lead is disqualified", async () => {
		const fake = fakeDeals({ deals: [{ ...OPEN }] });

		await moveLeadDeal("c1", DealStage.UNQUALIFIED_TO_BUY, fake.db, NOW);

		expect(fake.events.map((event) => event.type)).toEqual([
			"deal.stage.changed",
			"deal.closed",
		]);
	});

	it("opens a new deal when the only deal is closed", async () => {
		const fake = fakeDeals({
			deals: [{ ...OPEN, id: "d-lost", stage: DealStage.CLOSED_LOST }],
		});

		const move = await moveLeadDeal("c1", DealStage.DEMO_BOOKED, fake.db, NOW);

		expect(move.created).not.toBeNull();
		expect(fake.deals.find((deal) => deal.id === "d-lost")?.stage).toBe(
			DealStage.CLOSED_LOST,
		);
	});
});
