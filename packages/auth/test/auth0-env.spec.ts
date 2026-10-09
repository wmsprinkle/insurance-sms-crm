import { afterEach, describe, expect, it } from "bun:test";

const KEYS = [
	"AUTH0_DOMAIN",
	"AUTH0_CLIENT_ID",
	"AUTH0_CLIENT_SECRET",
] as const;

afterEach(() => {
	for (const key of KEYS) delete process.env[key];
});

async function load() {
	return import(`../src/env?${crypto.randomUUID()}`);
}

describe("Auth0 credentials", () => {
	it("are off when none are set", async () => {
		const { env, isAuth0Configured } = await load();
		expect(env.auth0).toBeUndefined();
		expect(isAuth0Configured()).toBe(false);
	});

	it("are on when domain, id and secret are all set", async () => {
		process.env.AUTH0_DOMAIN = "tenant.us.auth0.com";
		process.env.AUTH0_CLIENT_ID = "id";
		process.env.AUTH0_CLIENT_SECRET = "secret";
		const { env, isAuth0Configured } = await load();
		expect(env.auth0).toEqual({
			domain: "tenant.us.auth0.com",
			clientId: "id",
			clientSecret: "secret",
		});
		expect(isAuth0Configured()).toBe(true);
	});

	it("refuse a domain without the pair", async () => {
		process.env.AUTH0_DOMAIN = "tenant.us.auth0.com";
		await expect(load()).rejects.toThrow("must be set together");
	});

	it("refuse a pair without the domain", async () => {
		process.env.AUTH0_CLIENT_ID = "id";
		process.env.AUTH0_CLIENT_SECRET = "secret";
		await expect(load()).rejects.toThrow("must be set together");
	});
});
