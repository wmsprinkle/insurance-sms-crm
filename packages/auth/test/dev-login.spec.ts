import { describe, expect, it } from "bun:test";
import {
	devLoginFromEnvironment,
	firstAllowedAddress,
	resolveDevLogin,
} from "../src/dev-login";

const local = {
	DEV_LOGIN: "true",
	NODE_ENV: "development",
	ALLOWED_SIGN_IN: "me@gmail.com",
	apiUrl: "http://localhost:3001",
	appUrls: ["http://localhost:3000"],
};

describe("resolveDevLogin", () => {
	it("is off unless DEV_LOGIN is exactly the string true", () => {
		for (const value of [undefined, "", "false", "TRUE", "1", "yes", " true"]) {
			expect(resolveDevLogin({ ...local, DEV_LOGIN: value })).toEqual({
				enabled: false,
			});
		}
	});

	it("is on for localhost with an address allow-list", () => {
		expect(resolveDevLogin(local)).toEqual({
			enabled: true,
			email: "me@gmail.com",
		});
		expect(
			resolveDevLogin({
				...local,
				apiUrl: "http://127.0.0.1:3001",
				appUrls: ["http://127.0.0.1:3000"],
			}).enabled,
		).toBe(true);
	});

	it("refuses production", () => {
		expect(() => resolveDevLogin({ ...local, NODE_ENV: "production" })).toThrow(
			/not allowed when NODE_ENV is production/,
		);
	});

	it("stays off in production when DEV_LOGIN is not set", () => {
		expect(
			resolveDevLogin({
				...local,
				DEV_LOGIN: undefined,
				NODE_ENV: "production",
			}),
		).toEqual({ enabled: false });
	});

	it("refuses a non-local API or app host", () => {
		expect(() =>
			resolveDevLogin({ ...local, apiUrl: "https://api.example.com" }),
		).toThrow(/only allowed on localhost/);
		expect(() =>
			resolveDevLogin({
				...local,
				appUrls: ["http://localhost:3000", "https://crm.example.com"],
			}),
		).toThrow(/only allowed on localhost/);
		expect(() =>
			resolveDevLogin({ ...local, apiUrl: "http://localhost.evil.com" }),
		).toThrow(/only allowed on localhost/);
		expect(() => resolveDevLogin({ ...local, apiUrl: "not a url" })).toThrow();
	});

	it("needs a full address, not a domain, in ALLOWED_SIGN_IN", () => {
		expect(() =>
			resolveDevLogin({ ...local, ALLOWED_SIGN_IN: "acme.com" }),
		).toThrow(/full email address/);
		expect(() => resolveDevLogin({ ...local, ALLOWED_SIGN_IN: "" })).toThrow(
			/full email address/,
		);
	});

	it("uses the first address and respects the allow-list order", () => {
		expect(
			resolveDevLogin({
				...local,
				ALLOWED_SIGN_IN: "acme.com, First@Gmail.com ,second@gmail.com",
			}),
		).toEqual({ enabled: true, email: "first@gmail.com" });
		expect(firstAllowedAddress(undefined)).toBeUndefined();
	});
});

describe("devLoginFromEnvironment", () => {
	it("defaults the URLs to localhost", () => {
		expect(
			devLoginFromEnvironment({ DEV_LOGIN: "true", ALLOWED_SIGN_IN: "a@b.co" }),
		).toEqual({ enabled: true, email: "a@b.co" });
	});

	it("refuses to boot in production", () => {
		expect(() =>
			devLoginFromEnvironment({
				DEV_LOGIN: "true",
				NODE_ENV: "production",
				ALLOWED_SIGN_IN: "a@b.co",
			}),
		).toThrow(/production/);
	});

	it("reads API_URL and APP_URL", () => {
		expect(() =>
			devLoginFromEnvironment({
				DEV_LOGIN: "true",
				ALLOWED_SIGN_IN: "a@b.co",
				API_URL: "https://api.example.com",
			}),
		).toThrow(/localhost/);
	});
});
