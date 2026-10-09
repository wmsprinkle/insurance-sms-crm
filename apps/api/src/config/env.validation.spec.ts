import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { validateEnv } from "./env.validation";

const base = {
	DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/crm",
	BETTER_AUTH_SECRET: "x".repeat(32),
	ALLOWED_SIGN_IN: "me@gmail.com",
};

describe("validateEnv production", () => {
	const production = {
		...base,
		BETTER_AUTH_SECRET: "k3Jd9sLq2VxP8mZr4TnB7cYw1HfA6eUg0oIa5SdQ",
		NODE_ENV: "production",
		GOOGLE_CLIENT_ID: "id",
		GOOGLE_CLIENT_SECRET: "secret",
		API_URL: "https://api.example.com",
		APP_URL: "https://app.example.com",
	};

	it("boots with a safe production configuration", () => {
		expect(() => validateEnv(production)).not.toThrow();
	});

	it("refuses an insecure production configuration", () => {
		expect(() =>
			validateEnv({ ...production, API_URL: "http://api.example.com" }),
		).toThrow(/Refusing to start in production/);
	});
});
