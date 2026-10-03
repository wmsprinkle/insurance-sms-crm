import { describe, expect, it } from "bun:test";
import {
	brandName,
	DEFAULT_SMS_SETTINGS,
	firstMessageTemplate,
	licensedStates,
	parseSmsSettings,
	renderFirstMessage,
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

describe("renderFirstMessage", () => {
	it("fills the tokens", () => {
		expect(
			renderFirstMessage(
				"Hi {firstName}, {agency} here. Reply STOP to opt out.",
				{
					firstName: "Ana",
					agency: "Acme Insurance",
				},
			),
		).toBe("Hi Ana, Acme Insurance here. Reply STOP to opt out.");
	});

	it("uses a neutral greeting without a first name", () => {
		expect(
			renderFirstMessage("Hi {firstName}.", { firstName: " ", agency: "A" }),
		).toBe("Hi there.");
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
