import { afterEach, describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import {
	SIMULATE,
	simulatedInbound,
	simulateSummary,
} from "../src/sms/simulate";
import { SmsSimulateService } from "../src/sms/simulate.service";
import type { SmsService } from "../src/sms/sms.service";
import type { SmsInternalService } from "../src/sms/sms-internal.service";
import type { TelnyxInbound } from "../src/sms/telnyx-event";

const CONTACT = { id: "c1", firstName: "ana", phone: "+15125550123" };
const ENV_KEYS = ["DRY_RUN", "TELNYX_API_KEY", "TELNYX_FROM_NUMBER"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = saved[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

function setup(contact: typeof CONTACT | null = CONTACT) {
	const received: TelnyxInbound[] = [];
	const sends: Array<{ text: string; dryRun: boolean; purpose: string }> = [];
	const db = {
		contact: { findFirst: async () => contact },
		appSetting: { findUnique: async () => null },
		organization: { findUnique: async () => ({ name: "Acme Insurance" }) },
	};
	const sms = {
		receive: async (message: TelnyxInbound) => {
			received.push(message);
			return "stored" as const;
		},
	};
	const internal = {
		send: async (request: {
			text: string;
			dryRun: boolean;
			purpose: string;
		}) => {
			sends.push(request);
			return { status: "sent" as const, telnyxId: "dryrun-1", dryRun: true };
		},
	};
	const service = new SmsSimulateService(
		db as unknown as Db,
		sms as unknown as SmsService,
		internal as unknown as SmsInternalService,
	);
	return { service, received, sends };
}

function dryRunOff() {
	process.env.DRY_RUN = "false";
	process.env.TELNYX_API_KEY = "key";
}

function dryRunOn() {
	process.env.DRY_RUN = "true";
}

describe("simulateInbound", () => {
	it("refuses when DRY_RUN is off", async () => {
		dryRunOff();
		const { service, received } = setup();
		await expect(
			service.simulateInbound({ contactId: "c1", body: "yes" }),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(received).toHaveLength(0);
	});

	it("sends the text through the inbound handler as the lead", async () => {
		dryRunOn();
		const { service, received } = setup();
		const result = await service.simulateInbound({
			contactId: "c1",
			body: "Yes please",
		});
		expect(result.outcome).toBe("stored");
		expect(received[0]?.from).toBe(CONTACT.phone);
		expect(received[0]?.text).toBe("Yes please");
		expect(received[0]?.telnyxId.startsWith(SIMULATE.telnyxIdPrefix)).toBe(
			true,
		);
	});

	it("uses a fresh message id every time", async () => {
		dryRunOn();
		const { service, received } = setup();
		await service.simulateInbound({ contactId: "c1", body: "a" });
		await service.simulateInbound({ contactId: "c1", body: "a" });
		expect(received[0]?.telnyxId).not.toBe(received[1]?.telnyxId);
	});

	it("rejects a lead with no phone", async () => {
		dryRunOn();
		const { service } = setup(null);
		await expect(
			service.simulateInbound({ contactId: "c1", body: "yes" }),
		).rejects.toBeInstanceOf(NotFoundException);
	});
});

describe("sendTestFirstMessage", () => {
	it("refuses when DRY_RUN is off", async () => {
		dryRunOff();
		const { service, sends } = setup();
		await expect(
			service.sendTestFirstMessage({ contactId: "c1" }),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(sends).toHaveLength(0);
	});

	it("records a dry-run first message", async () => {
		dryRunOn();
		const { service, sends } = setup();
		const result = await service.sendTestFirstMessage({ contactId: "c1" });
		expect(result.status).toBe("sent");
		expect(sends[0]?.dryRun).toBe(true);
		expect(sends[0]?.purpose).toBe("first-touch");
		expect(result.text).toContain("Ana");
	});
});

describe("simulate helpers", () => {
	it("falls back to a placeholder number", () => {
		const message = simulatedInbound({
			from: "+15125550123",
			to: null,
			text: "hi",
			id: "x",
		});
		expect(message.to).toBe(SIMULATE.fallbackTo);
	});

	it("summarises keyword outcomes", () => {
		expect(simulateSummary("keyword-stop")).toBe(SIMULATE.fallbackSummary);
		expect(simulateSummary("stored")).toBe(SIMULATE.outcomeSummaries.stored);
	});
});
