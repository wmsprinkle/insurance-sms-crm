import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { validateEnv } from "./env.validation";

const base = {
	DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/crm",
	BETTER_AUTH_SECRET: "x".repeat(32),
	ALLOWED_SIGN_IN: "me@gmail.com",
};

describe("validateEnv DEV_LOGIN", () => {
	const production = {
		...base,
		BETTER_AUTH_SECRET: "k3Jd9sLq2VxP8mZr4TnB7cYw1HfA6eUg0oIa5SdQ",
		NODE_ENV: "production",
		GOOGLE_CLIENT_ID: "id",
		GOOGLE_CLIENT_SECRET: "secret",
		API_URL: "https://api.example.com",
		APP_URL: "https://app.example.com",
	};

	it("boots without DEV_LOGIN, in production too", () => {
		expect(() => validateEnv(production)).not.toThrow();
	});

	it("refuses an insecure production configuration", () => {
		expect(() =>
			validateEnv({ ...production, API_URL: "http://api.example.com" }),
		).toThrow(/Refusing to start in production/);
	});

	it("boots with DEV_LOGIN on localhost", () => {
		expect(() => validateEnv({ ...base, DEV_LOGIN: "true" })).not.toThrow();
	});

	it("boots with DEV_LOGIN in production behind a public URL", () => {
		expect(() =>
			validateEnv({ ...production, DEV_LOGIN: "true" }),
		).not.toThrow();
	});

	it("refuses a list of addresses", () => {
		expect(() =>
			validateEnv({
				...base,
				DEV_LOGIN: "true",
				ALLOWED_SIGN_IN: "a@gmail.com,b@gmail.com",
			}),
		).toThrow(/exactly one full email address/);
	});

	it("refuses a domain-only allow-list", () => {
		expect(() =>
			validateEnv({ ...base, DEV_LOGIN: "true", ALLOWED_SIGN_IN: "acme.com" }),
		).toThrow(/exactly one full email address/);
	});
});
