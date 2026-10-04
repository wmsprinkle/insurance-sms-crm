import { describe, expect, it } from "bun:test";
import {
	devLoginFromEnvironment,
	firstAllowedAddress,
	forwardingHeaderNames,
	isLoopbackAppRequest,
	isLoopbackPeer,
	isLoopbackRequest,
	loopbackHostname,
	resolveDevLogin,
} from "../src/dev-login";

const local = { DEV_LOGIN: "true", ALLOWED_SIGN_IN: "me@gmail.com" };

const direct = {
	peer: "127.0.0.1",
	host: "localhost:3000",
	headerNames: ["host", "content-type", "origin", "cookie", "user-agent"],
};

describe("resolveDevLogin", () => {
	it("is off unless DEV_LOGIN is exactly the string true", () => {
		for (const value of [undefined, "", "false", "TRUE", "1", "yes", " true"]) {
			expect(resolveDevLogin({ ...local, DEV_LOGIN: value })).toEqual({
				enabled: false,
			});
		}
	});

	it("is on with exactly one full address", () => {
		expect(resolveDevLogin(local)).toEqual({
			enabled: true,
			email: "me@gmail.com",
		});
		expect(
			resolveDevLogin({ ...local, ALLOWED_SIGN_IN: " First@Gmail.com " }),
		).toEqual({ enabled: true, email: "first@gmail.com" });
	});

	it("does not care about NODE_ENV or the public URL", () => {
		expect(
			devLoginFromEnvironment({
				...local,
				NODE_ENV: "production",
				API_URL: "https://api.example.com",
				APP_URL: "https://crm.example.com",
			}),
		).toEqual({ enabled: true, email: "me@gmail.com" });
	});

	it("refuses a domain, a list, a bare @ domain or nothing", () => {
		for (const value of [
			"acme.com",
			"@acme.com",
			"",
			undefined,
			"acme.com, me@gmail.com",
			"a@b.co,c@d.co",
			"a@b@c.co",
		]) {
			expect(() =>
				resolveDevLogin({ ...local, ALLOWED_SIGN_IN: value }),
			).toThrow(/exactly one full email address/);
		}
	});

	it("reads the first address for display helpers", () => {
		expect(firstAllowedAddress("acme.com, First@Gmail.com")).toBe(
			"first@gmail.com",
		);
		expect(firstAllowedAddress(undefined)).toBeUndefined();
	});
});

describe("isLoopbackPeer", () => {
	it("accepts the loopback addresses, IPv6-mapped included", () => {
		for (const peer of [
			"127.0.0.1",
			"::1",
			"::ffff:127.0.0.1",
			"::FFFF:127.0.0.1",
			"::ffff:7f00:1",
			"0:0:0:0:0:0:0:1",
		]) {
			expect(isLoopbackPeer(peer)).toBe(true);
		}
	});

	it("refuses everything else, empty values included", () => {
		for (const peer of [
			undefined,
			null,
			"",
			"  ",
			"10.0.0.5",
			"192.168.1.20",
			"127.0.0.2",
			"::ffff:10.0.0.5",
			"::2",
			"[::1]",
			"127.0.0.1, 8.8.8.8",
			"localhost",
		]) {
			expect(isLoopbackPeer(peer)).toBe(false);
		}
	});
});

describe("loopbackHostname", () => {
	it("accepts localhost, 127.0.0.1 and [::1] on any port", () => {
		for (const host of [
			"localhost",
			"localhost:3000",
			"LOCALHOST:8080",
			"127.0.0.1",
			"127.0.0.1:3000",
			"[::1]",
			"[::1]:3000",
		]) {
			expect(loopbackHostname(host)).toBeDefined();
		}
	});

	it("refuses a spoofed or malformed Host", () => {
		for (const host of [
			undefined,
			null,
			"",
			" ",
			"campfire-nervous-shamrock.ngrok-free.dev",
			"localhost.evil.com",
			"evil.com#localhost",
			"evil.com/localhost",
			"localhost@evil.com",
			"localhost:3000@evil.com",
			"user:pass@localhost",
			"localhost, evil.com",
			"evil.com, localhost",
			"localhost:abc",
			"localhost:",
			"localhost:3000:4000",
			"localhost:123456",
			"localhost.",
			"::1",
			"[::1",
			"[::1]x",
			"[::2]:3000",
			"127.0.0.2",
			"127.0.0.1.nip.io",
			"0.0.0.0",
			"localhost%00.evil.com",
			"local host",
		]) {
			expect(loopbackHostname(host)).toBeUndefined();
		}
	});
});

describe("forwardingHeaderNames", () => {
	it("finds every proxy and tunnel header, in any case", () => {
		const names = [
			"X-Forwarded-For",
			"x-forwarded-host",
			"x-forwarded-proto",
			"Forwarded",
			"X-Real-IP",
			"ngrok-skip-browser-warning",
			"Ngrok-Trace-Id",
			"cf-connecting-ip",
			"CF-Ray",
			"true-client-ip",
			"via",
		];
		expect(forwardingHeaderNames(names)).toHaveLength(names.length);
	});

	it("ignores ordinary headers", () => {
		expect(
			forwardingHeaderNames(["host", "cookie", "origin", "accept", "cfg"]),
		).toEqual([]);
	});
});

describe("isLoopbackRequest", () => {
	it("accepts a direct request to localhost", () => {
		expect(isLoopbackRequest(direct)).toBe(true);
		expect(isLoopbackRequest({ ...direct, host: "127.0.0.1:3001" })).toBe(true);
		expect(
			isLoopbackRequest({ ...direct, peer: "::ffff:127.0.0.1", host: "[::1]" }),
		).toBe(true);
	});

	it("refuses a request that arrives from another machine", () => {
		for (const peer of ["10.0.0.5", "203.0.113.9", "::ffff:10.0.0.5", ""]) {
			expect(isLoopbackRequest({ ...direct, peer })).toBe(false);
		}
		expect(isLoopbackRequest({ ...direct, peer: undefined })).toBe(false);
		expect(isLoopbackRequest({ ...direct, peer: null })).toBe(false);
	});

	it("refuses the public host even from a loopback peer", () => {
		expect(
			isLoopbackRequest({
				...direct,
				host: "campfire-nervous-shamrock.ngrok-free.dev",
			}),
		).toBe(false);
		expect(isLoopbackRequest({ ...direct, host: undefined })).toBe(false);
		expect(isLoopbackRequest({ ...direct, host: "" })).toBe(false);
	});

	it("refuses when a forwarding header is present, whatever the Host", () => {
		for (const header of [
			"x-forwarded-for",
			"x-forwarded-host",
			"forwarded",
			"x-real-ip",
			"ngrok-trace-id",
			"cf-connecting-ip",
		]) {
			expect(
				isLoopbackRequest({
					...direct,
					headerNames: [...direct.headerNames, header],
				}),
			).toBe(false);
		}
	});

	it("refuses a request that came through the edge proxy and the tunnel", () => {
		expect(
			isLoopbackRequest({
				peer: "127.0.0.1",
				host: "campfire-nervous-shamrock.ngrok-free.dev",
				headerNames: [
					"host",
					"x-forwarded-for",
					"x-forwarded-host",
					"ngrok-trace-id",
				],
			}),
		).toBe(false);
	});

	it("spoofing Host alone does not help a tunnel request", () => {
		expect(
			isLoopbackRequest({
				peer: "127.0.0.1",
				host: "localhost:3000",
				headerNames: ["host", "x-forwarded-for", "ngrok-trace-id"],
			}),
		).toBe(false);
	});

	it("fails closed on empty input", () => {
		expect(isLoopbackRequest({ peer: "", host: "", headerNames: [] })).toBe(
			false,
		);
		expect(
			isLoopbackRequest({ peer: undefined, host: undefined, headerNames: [] }),
		).toBe(false);
	});
});

describe("isLoopbackAppRequest", () => {
	const reader = (entries: Record<string, string>) => {
		const map = new Map(
			Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]),
		);
		return {
			get: (name: string) => map.get(name.toLowerCase()) ?? null,
			keys: () => map.keys(),
		};
	};

	const injected = {
		host: "localhost:3000",
		"x-forwarded-host": "localhost:3000",
		"x-forwarded-port": "3000",
		"x-forwarded-proto": "http",
		"x-forwarded-for": "127.0.0.1",
	};

	it("accepts the headers Next adds to a direct local request", () => {
		expect(isLoopbackAppRequest(reader(injected))).toBe(true);
		expect(
			isLoopbackAppRequest(
				reader({ ...injected, "x-forwarded-for": "::ffff:127.0.0.1" }),
			),
		).toBe(true);
		expect(isLoopbackAppRequest(reader({ host: "127.0.0.1:3000" }))).toBe(true);
	});

	it("refuses a request that carries a real client address", () => {
		expect(
			isLoopbackAppRequest(
				reader({ ...injected, "x-forwarded-for": "203.0.113.9" }),
			),
		).toBe(false);
		expect(
			isLoopbackAppRequest(
				reader({ ...injected, "x-forwarded-for": "127.0.0.1, 203.0.113.9" }),
			),
		).toBe(false);
		expect(
			isLoopbackAppRequest(reader({ ...injected, "x-forwarded-for": "" })),
		).toBe(false);
	});

	it("refuses the public host in Host or x-forwarded-host", () => {
		const publicHost = "campfire-nervous-shamrock.ngrok-free.dev";
		expect(
			isLoopbackAppRequest(
				reader({
					...injected,
					host: publicHost,
					"x-forwarded-host": publicHost,
				}),
			),
		).toBe(false);
		expect(
			isLoopbackAppRequest(
				reader({ ...injected, "x-forwarded-host": publicHost }),
			),
		).toBe(false);
		expect(
			isLoopbackAppRequest(reader({ ...injected, host: publicHost })),
		).toBe(false);
	});

	it("refuses tunnel, CDN and real-ip headers", () => {
		for (const header of [
			"forwarded",
			"x-real-ip",
			"ngrok-trace-id",
			"cf-ray",
		]) {
			expect(isLoopbackAppRequest(reader({ ...injected, [header]: "x" }))).toBe(
				false,
			);
		}
	});

	it("refuses a missing Host", () => {
		expect(isLoopbackAppRequest(reader({}))).toBe(false);
	});
});
