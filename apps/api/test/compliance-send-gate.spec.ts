import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import { ConsentService } from "../src/compliance/consent.service";
import { decide, SendGateService } from "../src/compliance/send-gate";
import { SuppressionService } from "../src/compliance/suppression.service";
import { fakeDb } from "./support/sms-db";

const OPEN = new Date("2026-10-05T15:00:00Z");
const NIGHT = new Date("2026-10-06T03:00:00Z");
const TO = "+12125550123";

function gate(seed: Parameters<typeof fakeDb>[0] = {}) {
	const { state, db } = fakeDb(seed);
	const client = db as unknown as Db;
	return {
		state,
		gate: new SendGateService(
			client,
			new ConsentService(client),
			new SuppressionService(client),
		),
	};
}

const consented = {
	consents: [
		{ id: "c1", contactId: "contact-1", source: "WEB_FORM", revokedAt: null },
	],
};

describe("decide", () => {
	const base = {
		purpose: "conversation" as const,
		consent: true,
		suppressed: false,
		withinHours: true,
		nextWindowAt: null,
	};

	it("allows a consented, unsuppressed send inside the window", () => {
		expect(decide(base)).toEqual({ allowed: true, reason: "consented" });
	});

	it("checks suppression before consent before quiet hours", () => {
		expect(
			decide({ ...base, suppressed: true, consent: false, withinHours: false }),
		).toMatchObject({ allowed: false, reason: "suppressed" });
		expect(
			decide({ ...base, consent: false, withinHours: false }),
		).toMatchObject({ allowed: false, reason: "no-consent" });
		const retryAt = new Date("2026-10-06T12:00:00Z");
		expect(
			decide({ ...base, withinHours: false, nextWindowAt: retryAt }),
		).toEqual({ allowed: false, reason: "quiet-hours", retryAt });
	});

	it("lets a keyword auto-reply through whatever the state", () => {
		expect(
			decide({
				...base,
				purpose: "keyword-reply",
				suppressed: true,
				consent: false,
				withinHours: false,
			}),
		).toEqual({ allowed: true, reason: "keyword-reply" });
	});
});

describe("SendGateService", () => {
	it("allows and audits a consented send", async () => {
		const { gate: service, state } = gate(consented);

		const decision = await service.check({
			to: TO,
			contactId: "contact-1",
			purpose: "conversation",
			now: OPEN,
		});

		expect(decision.allowed).toBe(true);
		expect(state.events).toMatchObject([
			{
				sessionId: "compliance:send-gate",
				contactId: "contact-1",
				type: "sms.send.allowed",
				data: { to: TO, reason: "consented", state: "NY" },
			},
		]);
	});

	it("blocks a contact without consent and audits why", async () => {
		const { gate: service, state } = gate();

		const decision = await service.check({
			to: TO,
			contactId: "contact-1",
			purpose: "conversation",
			now: OPEN,
		});

		expect(decision).toMatchObject({ allowed: false, reason: "no-consent" });
		expect(state.events[0]?.type).toBe("sms.send.blocked");
	});

	it("blocks a revoked consent", async () => {
		const { gate: service } = gate({
			consents: [
				{
					id: "c1",
					contactId: "contact-1",
					source: "WEB_FORM",
					revokedAt: new Date(),
				},
			],
		});

		await expect(
			service.check({
				to: TO,
				contactId: "contact-1",
				purpose: "conversation",
				now: OPEN,
			}),
		).resolves.toMatchObject({ reason: "no-consent" });
	});

	it("blocks a suppressed number even with consent", async () => {
		const { gate: service } = gate({
			...consented,
			suppressions: [{ e164: TO, reason: "STOP_KEYWORD" }],
		});

		await expect(
			service.check({
				to: TO,
				contactId: "contact-1",
				purpose: "conversation",
				now: OPEN,
			}),
		).resolves.toMatchObject({ reason: "suppressed" });
	});

	it("blocks at night and says when to retry", async () => {
		const { gate: service, state } = gate(consented);

		const decision = await service.check({
			to: TO,
			contactId: "contact-1",
			purpose: "conversation",
			now: NIGHT,
		});

		expect(decision).toEqual({
			allowed: false,
			reason: "quiet-hours",
			retryAt: new Date("2026-10-06T12:00:00Z"),
		});
		expect(state.events[0]?.data).toMatchObject({
			retryAt: "2026-10-06T12:00:00.000Z",
		});
	});

	it("audits keyword replies to unknown senders too", async () => {
		const { gate: service, state } = gate();

		await service.check({
			to: TO,
			contactId: null,
			purpose: "keyword-reply",
			now: NIGHT,
		});

		expect(state.events).toMatchObject([
			{
				contactId: null,
				type: "sms.send.allowed",
				data: { reason: "keyword-reply" },
			},
		]);
	});
});
