import { describe, expect, test } from "bun:test";
import {
	createDevLoginProof,
	DEV_LOGIN_PROOF_HEADER,
} from "@crm/auth/dev-login-proof";
import { handleDevLogin } from "../lib/dev-login-route";

const secret = "k".repeat(32);

function setup(
	upstream: () => Response | Promise<Response> = () =>
		Response.json({ ok: true }),
) {
	const calls: { url: string; init: RequestInit }[] = [];
	const deps = {
		apiUrl: "http://127.0.0.1:3001",
		secret,
		fetch: (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return upstream();
		}) as unknown as typeof fetch,
	};
	return { calls, deps };
}

function post(headers: Record<string, string>) {
	return new Request("http://localhost:3000/api/auth/dev-login", {
		method: "POST",
		headers,
	});
}

const local = {
	host: "localhost:3000",
	origin: "http://localhost:3000",
	"x-forwarded-for": "::ffff:127.0.0.1",
	"x-forwarded-host": "localhost:3000",
	"x-forwarded-proto": "http",
};

describe("dev login route", () => {
	test("signs in a direct local request and relays every cookie", async () => {
		const upstream = new Response('{"ok":true}', {
			headers: { "content-type": "application/json" },
		});
		upstream.headers.append("set-cookie", "crm.session=abc; Path=/; HttpOnly");
		upstream.headers.append("set-cookie", "crm.data=def; Path=/");
		const { calls, deps } = setup(() => upstream);

		const response = await handleDevLogin(post(local), deps);

		expect(response.status).toBe(200);
		expect(response.headers.getSetCookie()).toEqual([
			"crm.session=abc; Path=/; HttpOnly",
			"crm.data=def; Path=/",
		]);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("http://127.0.0.1:3001/api/auth/dev-login");
		const sent = new Headers(calls[0]?.init.headers);
		expect(sent.get(DEV_LOGIN_PROOF_HEADER)).toBe(createDevLoginProof(secret));
		expect(sent.get("x-forwarded-for")).toBeNull();
		expect(sent.get("cookie")).toBeNull();
		expect(sent.get("origin")).toBeNull();
	});

	test("accepts a request with no forwarding headers and no origin", async () => {
		const { deps } = setup();
		const response = await handleDevLogin(
			post({ host: "127.0.0.1:3000" }),
			deps,
		);
		expect(response.status).toBe(200);
	});

	test("relays a refusal from the API", async () => {
		const { deps } = setup(() =>
			Response.json({ message: "no" }, { status: 403 }),
		);
		const response = await handleDevLogin(post(local), deps);
		expect(response.status).toBe(403);
		expect(response.headers.getSetCookie()).toEqual([]);
	});

	test("refuses forged forwarding headers without calling the API", async () => {
		const forgedHeaders: Record<string, string>[] = [
			{ "x-forwarded-for": "203.0.113.9" },
			{ "x-forwarded-for": "127.0.0.1, 203.0.113.9" },
			{ "x-forwarded-host": "demo.ngrok-free.dev" },
			{ "ngrok-skip-browser-warning": "1" },
			{ "x-real-ip": "127.0.0.1" },
			{ forwarded: "for=203.0.113.9" },
			{ "cf-connecting-ip": "203.0.113.9" },
		];
		for (const forged of forgedHeaders) {
			const { calls, deps } = setup();
			const response = await handleDevLogin(
				post({ ...local, ...forged }),
				deps,
			);
			expect(response.status).toBe(403);
			expect(calls).toHaveLength(0);
		}
	});

	test("refuses a spoofed Host or a foreign origin", async () => {
		const bad: Record<string, string>[] = [
			{ ...local, host: "demo.ngrok-free.dev" },
			{ ...local, host: "localhost.evil.com" },
			{ ...local, host: "localhost:3000@evil.com" },
			{ ...local, origin: "https://demo.ngrok-free.dev" },
			{ origin: "http://localhost:3000" },
		];
		for (const headers of bad) {
			const { calls, deps } = setup();
			const response = await handleDevLogin(post(headers), deps);
			expect(response.status).toBe(403);
			expect(calls).toHaveLength(0);
		}
	});

	test("refuses when the app has no bridge secret", async () => {
		const { calls, deps } = setup();
		const response = await handleDevLogin(post(local), {
			...deps,
			secret: undefined,
		});
		expect(response.status).toBe(403);
		expect(calls).toHaveLength(0);
	});

	test("answers 502 when the API is down", async () => {
		const { deps } = setup(() => {
			throw new Error("down");
		});
		const response = await handleDevLogin(post(local), deps);
		expect(response.status).toBe(502);
	});
});
