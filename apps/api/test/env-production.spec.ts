import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import {
	productionProblems,
	type RawEnvironment,
} from "../src/config/env.validation";

const safe: RawEnvironment = {
	NODE_ENV: "production",
	BETTER_AUTH_SECRET: "k3Jd9sLq2VxP8mZr4TnB7cYw1HfA6eUg0oIa5SdQ",
	GOOGLE_CLIENT_ID: "id",
	GOOGLE_CLIENT_SECRET: "secret",
	API_URL: "https://api.example.com",
	APP_URL: "https://app.example.com",
	AGENT_URL: "http://127.0.0.1:2000",
	AGENT_BRIDGE_SECRET: "b".repeat(40),
	DRY_RUN: "true",
};

describe("productionProblems", () => {
	it("passes a safe production configuration", () => {
		expect(productionProblems(safe)).toEqual([]);
	});

	it("checks nothing outside production", () => {
		expect(productionProblems({ NODE_ENV: "development" })).toEqual([]);
	});

	it("requires OAuth credentials", () => {
		const { GOOGLE_CLIENT_ID: _id, ...rest } = safe;
		expect(productionProblems(rest).join()).toMatch(/OAuth/);
	});

	it("refuses http and localhost URLs and wildcards", () => {
		expect(
			productionProblems({ ...safe, API_URL: "http://api.example.com" }).join(),
		).toMatch(/API_URL must be an https/);
		expect(
			productionProblems({ ...safe, APP_URL: "https://localhost:3000" }).join(),
		).toMatch(/APP_URL must not be localhost/);
		expect(
			productionProblems({ ...safe, APP_URL: "https://*.example.com" }).join(),
		).toMatch(/wildcard/);
	});

	it("refuses a short bridge secret when the agent is configured", () => {
		expect(
			productionProblems({ ...safe, AGENT_BRIDGE_SECRET: "short" }).join(),
		).toMatch(/AGENT_BRIDGE_SECRET/);
	});

	it("refuses live sending without the Telnyx keys", () => {
		const problems = productionProblems({ ...safe, DRY_RUN: "false" }).join();
		expect(problems).toMatch(/TELNYX_PUBLIC_KEY/);
		expect(problems).toMatch(/TELNYX_API_KEY/);
	});

	it("refuses a placeholder auth secret", () => {
		expect(
			productionProblems({
				...safe,
				BETTER_AUTH_SECRET: "changeme".repeat(5),
			}).join(),
		).toMatch(/placeholder/);
	});
});
