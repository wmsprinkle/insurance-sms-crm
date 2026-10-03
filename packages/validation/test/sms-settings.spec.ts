import { describe, expect, it } from "bun:test";
import {
	DEFAULT_SMS_SETTINGS,
	firstMessageTemplate,
	parseSmsSettings,
	renderFirstMessage,
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
