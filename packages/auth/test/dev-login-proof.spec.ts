import { describe, expect, it } from "bun:test";
import {
	createDevLoginProof,
	verifyDevLoginProof,
} from "../src/dev-login-proof";

const secret = "s".repeat(32);

describe("dev login proof", () => {
	it("accepts the proof made from the same secret", () => {
		expect(verifyDevLoginProof(secret, createDevLoginProof(secret))).toBe(true);
	});

	it("refuses a missing or empty proof", () => {
		expect(verifyDevLoginProof(secret, null)).toBe(false);
		expect(verifyDevLoginProof(secret, undefined)).toBe(false);
		expect(verifyDevLoginProof(secret, "")).toBe(false);
	});

	it("refuses a proof made from another secret", () => {
		expect(
			verifyDevLoginProof(secret, createDevLoginProof("x".repeat(32))),
		).toBe(false);
	});

	it("refuses a wrong length proof and the raw secret", () => {
		expect(verifyDevLoginProof(secret, "abc")).toBe(false);
		expect(verifyDevLoginProof(secret, secret)).toBe(false);
	});

	it("refuses everything when the API has no secret", () => {
		expect(verifyDevLoginProof(undefined, createDevLoginProof(secret))).toBe(
			false,
		);
		expect(verifyDevLoginProof("", createDevLoginProof(""))).toBe(false);
	});
});
