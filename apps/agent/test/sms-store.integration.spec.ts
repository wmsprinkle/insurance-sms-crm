import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ConsentSource, db, SmsDirection, SmsDraftStatus } from "@crm/db";
import { prismaBookingStore } from "../agent/lib/sms-booking";
import { prismaSmsStore } from "../agent/lib/sms-store";

const phone = `+1512555${String(Math.floor(Math.random() * 9000) + 1000)}`;
const email = `sms-store-${crypto.randomUUID()}@example.test`;

async function clear() {
	const contacts = await db.contact.findMany({
		where: { email },
		select: { id: true },
	});
	const ids = contacts.map((contact) => contact.id);
	await db.agentTask.deleteMany({ where: { contactId: { in: ids } } });
	await db.smsDraft.deleteMany({ where: { contactId: { in: ids } } });
	await db.smsMessage.deleteMany({ where: { contactId: { in: ids } } });
	await db.consentRecord.deleteMany({ where: { contactId: { in: ids } } });
	await db.phoneSuppression.deleteMany({ where: { e164: phone } });
	await db.contact.deleteMany({ where: { email } });
}

beforeEach(clear);
afterEach(clear);

async function lead() {
	const contact = await db.contact.create({
		data: { firstName: "Store", email, phone },
		select: { id: true },
	});
	await db.consentRecord.create({
		data: {
			contactId: contact.id,
			e164: phone,
			source: ConsentSource.WEB_FORM,
			capturedAt: new Date(),
		},
	});
	return contact.id;
}

describe("prismaSmsStore", () => {
	it("reads a consented, unsuppressed number as sendable", async () => {
		const contactId = await lead();
		expect(await prismaSmsStore.sendBlock(contactId, phone)).toBeNull();
	});

	it("opts out once, discards pending drafts and then reads suppressed", async () => {
		const contactId = await lead();
		await prismaSmsStore.saveDraft({
			contactId,
			body: "stale",
			reason: "approval-mode",
			retryAt: null,
			taskId: null,
			idempotencyKey: "send_sms:t-old",
		});

		const first = await prismaSmsStore.optOut({
			contactId,
			phone,
			reason: "opt_out",
			keepTaskId: null,
		});
		const second = await prismaSmsStore.optOut({
			contactId,
			phone,
			reason: "opt_out",
			keepTaskId: null,
		});

		expect(first.created).toBe(true);
		expect(second.created).toBe(false);
		expect(second.suppressedAt.getTime()).toBe(first.suppressedAt.getTime());
		expect(await prismaSmsStore.sendBlock(contactId, phone)).toBe("suppressed");
		const drafts = await db.smsDraft.findMany({ where: { contactId } });
		expect(drafts.map((draft) => draft.status)).toEqual([
			SmsDraftStatus.DISCARDED,
		]);
	});

	it("counts model turns by started tasks with a session, total and per hour", async () => {
		const contactId = await lead();
		const hourAgo = new Date(Date.now() - 60 * 60_000);
		const now = new Date();
		const turn = (startedAt: Date, sessionId: string | null) =>
			db.agentTask.create({
				data: {
					contactId,
					kind: "sms-reply",
					reason: "Lead replied",
					dueAt: startedAt,
					startedAt,
					sessionId,
				},
			});
		await turn(new Date(now.getTime() - 3 * 60 * 60_000), "crm:sms:a");
		await turn(new Date(now.getTime() - 60_000), "crm:sms:b");
		await turn(now, null);

		expect(await prismaSmsStore.modelTurns(contactId, hourAgo)).toEqual({
			recent: 1,
			total: 2,
		});
	});

	it("discards only pending drafts", async () => {
		const contactId = await lead();
		const draft = (key: string) =>
			prismaSmsStore.saveDraft({
				contactId,
				body: key,
				reason: "approval-mode",
				retryAt: null,
				taskId: null,
				idempotencyKey: key,
			});
		const first = await draft("send_sms:t-a");
		await draft("send_sms:t-b");
		await db.smsDraft.update({
			where: { id: first.id },
			data: { status: SmsDraftStatus.APPROVED },
		});

		expect(await prismaSmsStore.discardDrafts(contactId)).toBe(1);
		const rows = await db.smsDraft.findMany({
			where: { contactId },
			orderBy: { createdAt: "asc" },
		});
		expect(rows.map((row) => row.status).sort()).toEqual([
			SmsDraftStatus.APPROVED,
			SmsDraftStatus.DISCARDED,
		]);
	});

	it("records a reply by its draft key", async () => {
		const contactId = await lead();
		expect(await prismaSmsStore.replyRecorded("send_sms:t-1")).toBe(false);
		await prismaSmsStore.saveDraft({
			contactId,
			body: "hi",
			reason: "approval-mode",
			retryAt: null,
			taskId: "t-1",
			idempotencyKey: "send_sms:t-1",
		});
		expect(await prismaSmsStore.replyRecorded("send_sms:t-1")).toBe(true);
	});

	it("knows which email the lead typed", async () => {
		const contactId = await lead();
		await db.smsMessage.create({
			data: {
				contactId,
				direction: SmsDirection.INBOUND,
				body: "sure, use Dana@Example.com",
			},
		});

		expect(
			await prismaBookingStore.leadTyped(contactId, "dana@example.com"),
		).toBe(true);
		expect(
			await prismaBookingStore.leadTyped(contactId, "boss@example.com"),
		).toBe(false);
	});
});
