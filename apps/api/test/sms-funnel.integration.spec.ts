import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type Db, db, SmsDirection } from "@crm/db";
import { DealStage } from "@crm/db/enums";
import { FUNNEL_HOLD_REASONS } from "@crm/validation/funnel-status";
import { loadFunnelStatuses } from "../src/sms/sms-funnel";

const suffix = crypto.randomUUID().slice(0, 8);
const ownerId = `funnel-owner-${suffix}`;
const area = String(Math.floor(Math.random() * 700) + 200);
let companyId = "";
const contactIds: string[] = [];
const phones: string[] = [];

async function lead(name: string, index: number) {
	const phone = `+1${area}555${String(1000 + index)}`;
	const contact = await db.contact.create({
		data: {
			firstName: name,
			email: `${name}-${suffix}@funnel.example.test`,
			phone,
		},
		select: { id: true },
	});
	contactIds.push(contact.id);
	phones.push(phone);
	return { id: contact.id, phone };
}

async function text(contactId: string, direction: SmsDirection, body = "x") {
	await db.smsMessage.create({ data: { contactId, direction, body } });
}

async function deal(contactId: string, stage: DealStage) {
	const created = await db.deal.create({
		data: {
			name: `Funnel ${stage}`,
			companyId,
			ownerId,
			stage,
			contacts: { create: { contactId } },
		},
		select: { id: true },
	});
	return created.id;
}

async function statusOf(person: { id: string; phone: string }) {
	const map = await loadFunnelStatuses(db as Db, [person]);
	return map.get(person.id);
}

beforeAll(async () => {
	await db.user.create({
		data: {
			id: ownerId,
			name: "Funnel Owner",
			email: `${ownerId}@example.test`,
		},
	});
	const company = await db.company.create({
		data: { name: "Funnel Co", domain: `funnel-${suffix}.example.test` },
		select: { id: true },
	});
	companyId = company.id;
});

afterAll(async () => {
	await db.agentTask.deleteMany({ where: { contactId: { in: contactIds } } });
	await db.deal.deleteMany({ where: { companyId } });
	await db.smsHandoff.deleteMany({ where: { contactId: { in: contactIds } } });
	await db.phoneSuppression.deleteMany({ where: { e164: { in: phones } } });
	await db.smsMessage.deleteMany({ where: { contactId: { in: contactIds } } });
	await db.contact.deleteMany({ where: { id: { in: contactIds } } });
	await db.company.deleteMany({ where: { id: companyId } });
	await db.user.deleteMany({ where: { id: ownerId } });
});

describe("loadFunnelStatuses", () => {
	it("returns nothing for no contacts", async () => {
		expect((await loadFunnelStatuses(db as Db, [])).size).toBe(0);
	});

	it("walks new, texted and replied from the messages", async () => {
		const person = await lead("walk", 1);
		expect(await statusOf(person)).toBe("new");

		await text(person.id, SmsDirection.OUTBOUND);
		expect(await statusOf(person)).toBe("texted");

		await text(person.id, SmsDirection.INBOUND, "who is this");
		expect(await statusOf(person)).toBe("replied");
	});

	it("is interested once a model turn ran", async () => {
		const person = await lead("turn", 2);
		await text(person.id, SmsDirection.OUTBOUND);
		await text(person.id, SmsDirection.INBOUND, "yes");
		await db.agentTask.create({
			data: {
				contactId: person.id,
				kind: "sms-reply",
				reason: "Lead replied",
				dueAt: new Date(),
				sessionId: "crm:sms:turn",
			},
		});

		expect(await statusOf(person)).toBe("interested");
	});

	it("is not_interested when the decline task is recorded, with no deal", async () => {
		const person = await lead("decline", 3);
		await text(person.id, SmsDirection.INBOUND, "no thanks");
		await db.agentTask.create({
			data: {
				contactId: person.id,
				kind: "sms-reply",
				reason: "Lead replied",
				dueAt: new Date(),
				finishedAt: new Date(),
				outcome: "not-interested: the lead declined",
			},
		});

		expect(await statusOf(person)).toBe("not_interested");
	});

	it("is not_interested for an unqualified deal and booked for a booked one", async () => {
		const no = await lead("deal-no", 4);
		await deal(no.id, DealStage.UNQUALIFIED_TO_BUY);
		expect(await statusOf(no)).toBe("not_interested");

		const yes = await lead("deal-yes", 5);
		await deal(yes.id, DealStage.DEMO_BOOKED);
		expect(await statusOf(yes)).toBe("booked");

		const maybe = await lead("deal-q", 6);
		await deal(maybe.id, DealStage.QUALIFIED_TO_BUY);
		expect(await statusOf(maybe)).toBe("interested");
	});

	it("is needs_you for an open ambiguous hold and abusive for an abusive one", async () => {
		const held = await lead("held", 7);
		await db.smsHandoff.create({
			data: { contactId: held.id, reason: FUNNEL_HOLD_REASONS.ambiguous },
		});
		expect(await statusOf(held)).toBe("needs_you");

		const rude = await lead("rude", 8);
		await db.smsHandoff.create({
			data: { contactId: rude.id, reason: FUNNEL_HOLD_REASONS.abusive },
		});
		expect(await statusOf(rude)).toBe("abusive");

		await db.smsHandoff.update({
			where: { contactId: rude.id },
			data: { resolvedAt: new Date() },
		});
		expect(await statusOf(rude)).toBe("new");
	});

	it("is opted_out for a suppressed phone, over every other state", async () => {
		const person = await lead("stopped", 9);
		await deal(person.id, DealStage.DEMO_BOOKED);
		await db.phoneSuppression.create({
			data: { e164: person.phone, reason: "STOP_KEYWORD" },
		});

		expect(await statusOf(person)).toBe("opted_out");
	});

	it("derives many contacts in one call", async () => {
		const a = await lead("many-a", 10);
		const b = await lead("many-b", 11);
		await text(b.id, SmsDirection.OUTBOUND);

		const map = await loadFunnelStatuses(db as Db, [a, b]);

		expect(map.get(a.id)).toBe("new");
		expect(map.get(b.id)).toBe("texted");
	});
});
