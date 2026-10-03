import { describe, expect, it } from "bun:test";
import { securityHeaders } from "./security-headers";

function headerValue(rules: ReturnType<typeof securityHeaders>, key: string) {
	return rules
		.flatMap((rule) => rule.headers)
		.find((header) => header.key === key)?.value;
}

describe("securityHeaders", () => {
	it("forbids framing and sniffing on app pages", () => {
		const rules = securityHeaders(true);
		const pages = rules[0];
		const keys = pages?.headers.map((header) => header.key) ?? [];
		expect(keys).toContain("X-Frame-Options");
		expect(headerValue(rules, "Content-Security-Policy")).toContain(
			"frame-ancestors 'none'",
		);
		expect(headerValue(rules, "X-Content-Type-Options")).toBe("nosniff");
	});

	it("leaves the tracking script embeddable", () => {
		const tracking = securityHeaders(true).find((rule) =>
			rule.source.startsWith("/t/"),
		);
		const keys = tracking?.headers.map((header) => header.key) ?? [];
		expect(keys).not.toContain("X-Frame-Options");
		expect(keys).not.toContain("Content-Security-Policy");
	});

	it("sends HSTS only in production", () => {
		expect(
			headerValue(securityHeaders(true), "Strict-Transport-Security"),
		).toMatch(/max-age=/);
		expect(
			headerValue(securityHeaders(false), "Strict-Transport-Security"),
		).toBeUndefined();
	});
});
