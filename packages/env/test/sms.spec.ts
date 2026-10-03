import { describe, expect, it } from "bun:test";
import { readSmsEnv } from "../src/sms";

describe("readSmsEnv", () => {
	it("defaults to dry run with nothing configured", () => {
		expect(readSmsEnv({})).toEqual({
			apiKey: null,
			publicKey: null,
			messagingProfileId: null,
			fromNumber: null,
			messagesPerSecond: null,
			dryRun: true,
		});
	});

	it("stays in dry run unless DRY_RUN is exactly false", () => {
		const base = { TELNYX_API_KEY: "key" };
		expect(readSmsEnv(base).dryRun).toBe(true);
		expect(readSmsEnv({ ...base, DRY_RUN: "0" }).dryRun).toBe(true);
		expect(readSmsEnv({ ...base, DRY_RUN: "true" }).dryRun).toBe(true);
		expect(readSmsEnv({ ...base, DRY_RUN: " false " }).dryRun).toBe(false);
	});

	it("forces dry run without an API key", () => {
		expect(readSmsEnv({ DRY_RUN: "false" }).dryRun).toBe(true);
	});

	it("reads the rate and ignores values that are not positive numbers", () => {
		expect(readSmsEnv({ TELNYX_MPS: "20" }).messagesPerSecond).toBe(20);
		expect(readSmsEnv({ TELNYX_MPS: "0" }).messagesPerSecond).toBeNull();
		expect(readSmsEnv({ TELNYX_MPS: "fast" }).messagesPerSecond).toBeNull();
	});

	it("treats blank values as missing", () => {
		expect(readSmsEnv({ TELNYX_FROM_NUMBER: "  " }).fromNumber).toBeNull();
	});
});
