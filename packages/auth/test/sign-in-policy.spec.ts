import { afterEach, describe, expect, it } from "bun:test";
import { checkSignIn } from "../src/sign-in-policy";

const original = process.env.ALLOWED_SIGN_IN;

afterEach(() => {
	if (original === undefined) delete process.env.ALLOWED_SIGN_IN;
	else process.env.ALLOWED_SIGN_IN = original;
});

describe("checkSignIn", () => {
	it("refuses everyone when no allow-list is set", () => {
		delete process.env.ALLOWED_SIGN_IN;
		expect(checkSignIn({ email: "a@acme.com", emailVerified: true }).ok).toBe(
			false,
		);
	});

	it("refuses an unverified provider email even when it is on the list", () => {
		process.env.ALLOWED_SIGN_IN = "acme.com";
		for (const emailVerified of [false, null, undefined]) {
			expect(checkSignIn({ email: "a@acme.com", emailVerified }).ok).toBe(
				false,
			);
		}
	});

	it("refuses an address off the list", () => {
		process.env.ALLOWED_SIGN_IN = "acme.com,me@gmail.com";
		for (const email of [
			"a@evil.com",
			"a@acme.com.evil.com",
			"x@gmail.com",
			"",
		]) {
			expect(checkSignIn({ email, emailVerified: true }).ok).toBe(false);
		}
	});

	it("allows a verified listed domain, subdomain or address", () => {
		process.env.ALLOWED_SIGN_IN = "acme.com,me@gmail.com";
		for (const email of ["A@Acme.com", "a@eu.acme.com", "me@gmail.com"]) {
			expect(checkSignIn({ email, emailVerified: true }).ok).toBe(true);
		}
	});
});
