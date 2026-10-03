import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { validateEnv } from "./env.validation";

const base = {
	DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/crm",
	BETTER_AUTH_SECRET: "x".repeat(32),
	ALLOWED_SIGN_IN: "me@gmail.com",
};

describe("validateEnv DEV_LOGIN", () => {
	it("boots without DEV_LOGIN, in production too", () => {
		expect(() =>
			validateEnv({ ...base, NODE_ENV: "production" }),
		).not.toThrow();
	});

	it("boots with DEV_LOGIN on localhost", () => {
		expect(() => validateEnv({ ...base, DEV_LOGIN: "true" })).not.toThrow();
	});

	it("refuses to boot with DEV_LOGIN in production", () => {
		expect(() =>
			validateEnv({ ...base, DEV_LOGIN: "true", NODE_ENV: "production" }),
		).toThrow(/DEV_LOGIN=true is not allowed/);
	});

	it("refuses a non-local API_URL", () => {
		expect(() =>
			validateEnv({
				...base,
				DEV_LOGIN: "true",
				API_URL: "https://api.example.com",
			}),
		).toThrow(/localhost/);
	});

	it("refuses a domain-only allow-list", () => {
		expect(() =>
			validateEnv({ ...base, DEV_LOGIN: "true", ALLOWED_SIGN_IN: "acme.com" }),
		).toThrow(/full email address/);
	});
});
