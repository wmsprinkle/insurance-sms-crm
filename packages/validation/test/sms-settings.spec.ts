import { describe, expect, it } from "bun:test";
import {
	brandName,
	DEFAULT_SMS_SETTINGS,
	FIRST_MESSAGE_RISK_WARNING,
	firstMessageTemplate,
	licensedStates,
	parseSmsSettings,
	resolveBrand,
	SMS_BRAND_FALLBACK,
} from "../src/sms-settings";

describe("parseSmsSettings", () => {
	it("returns the defaults when nothing is stored", () => {
		expect(parseSmsSettings(null)).toEqual({ ...DEFAULT_SMS_SETTINGS });
	});

	it("defaults to disclose and drafts", () => {
		expect(DEFAULT_SMS_SETTINGS.disclosureMode).toBe("disclose");
		expect(DEFAULT_SMS_SETTINGS.autoSend).toBe(false);
	});

	it("fills missing keys from the defaults", () => {
		expect(parseSmsSettings({ autoSend: true })).toEqual({
			...DEFAULT_SMS_SETTINGS,
			autoSend: true,
		});
	});

	it("throws on a stored value of the wrong type", () => {
		expect(() => parseSmsSettings({ disclosureMode: "lie" })).toThrow(
			/disclosureMode/,
		);
	});
});

describe("firstMessageTemplate", () => {
	it("accepts the default template", () => {
		expect(
			firstMessageTemplate.safeParse(DEFAULT_SMS_SETTINGS.firstMessageTemplate)
				.success,
		).toBe(true);
	});

	it("rejects a template without STOP", () => {
		expect(
			firstMessageTemplate.safeParse(
				"Hi {firstName}, this is {agency} about your quote.",
			).success,
		).toBe(false);
	});
});

describe("funnel settings", () => {
	it("defaults to no brand prefix, no STOP footer and human review", () => {
		expect(DEFAULT_SMS_SETTINGS.firstMessageBrandPrefix).toBe(false);
		expect(DEFAULT_SMS_SETTINGS.firstMessageStopFooter).toBe(false);
		expect(DEFAULT_SMS_SETTINGS.ambiguousMode).toBe("human");
	});

	it("fills them for a row stored before they existed", () => {
		const parsed = parseSmsSettings({ autoSend: true, brandName: "Acme" });
		expect(parsed.firstMessageBrandPrefix).toBe(false);
		expect(parsed.firstMessageStopFooter).toBe(false);
		expect(parsed.ambiguousMode).toBe("human");
	});

	it("reads stored values", () => {
		const parsed = parseSmsSettings({
			firstMessageBrandPrefix: true,
			firstMessageStopFooter: true,
			ambiguousMode: "llm",
		});
		expect(parsed.firstMessageBrandPrefix).toBe(true);
		expect(parsed.firstMessageStopFooter).toBe(true);
		expect(parsed.ambiguousMode).toBe("llm");
	});

	it("rejects an unknown ambiguous mode", () => {
		expect(() => parseSmsSettings({ ambiguousMode: "maybe" })).toThrow(
			/ambiguousMode/,
		);
	});

	it("carries a visible warning about verification", () => {
		expect(FIRST_MESSAGE_RISK_WARNING).toMatch(/business identification/);
		expect(FIRST_MESSAGE_RISK_WARNING).toMatch(/opt-out/);
	});
});

describe("brand name and licensed states", () => {
	it("defaults to no brand and no state limit", () => {
		expect(DEFAULT_SMS_SETTINGS.brandName).toBe("");
		expect(DEFAULT_SMS_SETTINGS.licensedStates).toEqual([]);
		expect(parseSmsSettings(null).licensedStates).toEqual([]);
	});

	it("falls back from the setting to the workspace name to a fixed name", () => {
		expect(resolveBrand(" Acme ", "Workspace")).toBe("Acme");
		expect(resolveBrand("", " Workspace ")).toBe("Workspace");
		expect(resolveBrand("  ", null)).toBe(SMS_BRAND_FALLBACK);
	});

	it("rejects a brand name that holds a link or an email", () => {
		expect(brandName.safeParse("acme.com/quote").success).toBe(false);
		expect(brandName.safeParse("me@acme.com").success).toBe(false);
		expect(brandName.safeParse("Acme Insurance, LLC").success).toBe(true);
	});

	it("rejects a brand name over the limit", () => {
		expect(brandName.safeParse("a".repeat(81)).success).toBe(false);
	});

	it("normalises state codes and rejects bad or repeated ones", () => {
		expect(licensedStates.parse([" tx", "FL"])).toEqual(["TX", "FL"]);
		expect(licensedStates.safeParse(["Texas"]).success).toBe(false);
		expect(licensedStates.safeParse(["TX", "tx"]).success).toBe(false);
	});

	it("fills a stored value without the new keys from the defaults", () => {
		expect(parseSmsSettings({ autoSend: true }).brandName).toBe("");
	});
});
