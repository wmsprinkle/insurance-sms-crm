import { describe, expect, it } from "bun:test";
import {
	parseLeadSourceSecrets,
	signLeadBody,
	verifyLeadSignature,
} from "../src/leads/lead-ingest-signature";
import { leadIngestBody } from "../src/leads/leads.contracts";

const SECRET = "s3cret-s3cret-s3cret";
const NOW = Date.parse("2026-10-03T12:00:00Z");
const TIMESTAMP = String(NOW / 1_000);
const BODY = JSON.stringify({ phone: "5552010001" });
const secrets = parseLeadSourceSecrets(`webform:${SECRET}`);

function check(overrides: Partial<Parameters<typeof verifyLeadSignature>[0]>) {
	return verifyLeadSignature({
		secrets,
		source: "webform",
		timestamp: TIMESTAMP,
		signature: signLeadBody(SECRET, TIMESTAMP, BODY),
		body: BODY,
		now: NOW,
		...overrides,
	});
}

describe("parseLeadSourceSecrets", () => {
	it("reads comma-separated source:secret pairs", () => {
		const parsed = parseLeadSourceSecrets(
			` webform:${SECRET} , vendor_2:${SECRET}x `,
		);
		expect([...parsed.entries()]).toEqual([
			["webform", SECRET],
			["vendor_2", `${SECRET}x`],
		]);
	});

	it("returns no sources when unset", () => {
		expect(parseLeadSourceSecrets(undefined).size).toBe(0);
		expect(parseLeadSourceSecrets("").size).toBe(0);
	});

	it("rejects a short secret and a bad source id", () => {
		expect(() => parseLeadSourceSecrets("webform:short")).toThrow(
			/shorter than 16/,
		);
		expect(() => parseLeadSourceSecrets(`Web Form:${SECRET}`)).toThrow(
			/not a valid lead source id/,
		);
		expect(() => parseLeadSourceSecrets(SECRET)).toThrow(/malformed/);
	});
});

describe("verifyLeadSignature", () => {
	it("accepts a correct signature", () => {
		expect(check({})).toBe(true);
	});

	it("accepts an upper-case hex signature", () => {
		expect(
			check({ signature: signLeadBody(SECRET, TIMESTAMP, BODY).toUpperCase() }),
		).toBe(true);
	});

	it("rejects a tampered body", () => {
		expect(check({ body: `${BODY} ` })).toBe(false);
	});

	it("rejects an unknown source and missing headers", () => {
		expect(check({ source: "other" })).toBe(false);
		expect(check({ source: undefined })).toBe(false);
		expect(check({ timestamp: undefined })).toBe(false);
		expect(check({ signature: undefined })).toBe(false);
	});

	it("rejects a signature made with another source's secret", () => {
		expect(
			check({ signature: signLeadBody(`${SECRET}-other`, TIMESTAMP, BODY) }),
		).toBe(false);
	});

	it("rejects a timestamp outside the five minute window", () => {
		const stale = String(NOW / 1_000 - 301);
		expect(
			check({ timestamp: stale, signature: signLeadBody(SECRET, stale, BODY) }),
		).toBe(false);
		const fresh = String(NOW / 1_000 - 299);
		expect(
			check({ timestamp: fresh, signature: signLeadBody(SECRET, fresh, BODY) }),
		).toBe(true);
	});

	it("rejects a non-numeric timestamp", () => {
		expect(
			check({
				timestamp: "1e9",
				signature: signLeadBody(SECRET, "1e9", BODY),
			}),
		).toBe(false);
	});
});

describe("leadIngestBody", () => {
	it("requires a phone and a consent object", () => {
		expect(leadIngestBody.safeParse({ phone: "5552010001" }).success).toBe(
			false,
		);
		expect(
			leadIngestBody.safeParse({
				phone: "5552010001",
				consent: {
					source: "web_form",
					capturedAt: "2026-10-01T00:00:00Z",
					optInUrl: "https://example.com/form",
				},
			}).success,
		).toBe(true);
	});

	it("caps field length", () => {
		expect(
			leadIngestBody.safeParse({
				phone: "5".repeat(501),
				consent: { source: "api", capturedAt: "2026-10-01" },
			}).success,
		).toBe(false);
	});
});
