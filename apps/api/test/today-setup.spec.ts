import { describe, expect, it } from "bun:test";
import { readSmsEnv } from "@crm/env/sms";
import {
	describeSetup,
	maskPhone,
	modelKeySet,
	webhookUrl,
} from "../src/today/setup";

describe("maskPhone", () => {
	it("hides the middle of a US number", () => {
		expect(maskPhone("+18335554120")).toBe("+1 833 *** 4120");
	});

	it("never returns the full number", () => {
		for (const phone of ["+18335554120", "+442071234567", "8335554120"]) {
			const masked = maskPhone(phone) ?? "";
			expect(masked).not.toContain(phone.slice(-7));
			expect(masked.endsWith(phone.slice(-4))).toBe(true);
		}
	});

	it("returns null for nothing or for too few digits", () => {
		expect(maskPhone(null)).toBeNull();
		expect(maskPhone("123")).toBeNull();
	});
});

describe("webhookUrl", () => {
	it("is the API origin plus the Telnyx path", () => {
		expect(webhookUrl({ API_URL: "https://api.acme.test/" })).toBe(
			"https://api.acme.test/webhooks/telnyx",
		);
	});

	it("falls back to the local API", () => {
		expect(webhookUrl({})).toBe("http://localhost:3001/webhooks/telnyx");
	});
});

describe("modelKeySet", () => {
	it("reads either variable and exposes neither", () => {
		expect(modelKeySet({})).toBe(false);
		expect(modelKeySet({ AI_GATEWAY_API_KEY: "  " })).toBe(false);
		expect(modelKeySet({ AI_GATEWAY_API_KEY: "secret" })).toBe(true);
		expect(modelKeySet({ VERCEL_OIDC_TOKEN: "token" })).toBe(true);
		expect(modelKeySet({ ANTHROPIC_API_KEY: "secret" })).toBe(true);
	});
});

describe("describeSetup", () => {
	it("reports the key and the number separately", () => {
		const facts = describeSetup(
			readSmsEnv({
				TELNYX_FROM_NUMBER: "+18335554120",
				TELNYX_MESSAGING_PROFILE_ID: "profile",
			}),
			{},
		);

		expect(facts.telnyxNumberSet).toBe(true);
		expect(facts.telnyxApiKeySet).toBe(false);
		expect(facts.telnyxConfigured).toBe(false);
		expect(facts.fromNumberMasked).toBe("+1 833 *** 4120");
		expect(JSON.stringify(facts)).not.toContain("5554120");
	});

	it("is configured with all three Telnyx variables", () => {
		const facts = describeSetup(
			readSmsEnv({
				TELNYX_API_KEY: "key",
				TELNYX_FROM_NUMBER: "+18335554120",
				TELNYX_MESSAGING_PROFILE_ID: "profile",
				TELNYX_PUBLIC_KEY: "pub",
			}),
			{},
		);

		expect(facts.telnyxConfigured).toBe(true);
		expect(facts.webhookKeySet).toBe(true);
	});
});
