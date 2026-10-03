import { describe, expect, it } from "bun:test";
import {
	canImportLeads,
	canManageCompliance,
	canSendSms,
	WORKSPACE_ROLES,
} from "../src/organization";

describe("compliance permissions", () => {
	it("lets only an owner or an admin change compliance settings or import leads", () => {
		for (const role of WORKSPACE_ROLES) {
			const admin = role === "owner" || role === "admin";
			expect(canManageCompliance(role)).toBe(admin);
			expect(canImportLeads(role)).toBe(admin);
		}
		expect(canManageCompliance(null)).toBe(false);
		expect(canImportLeads(null)).toBe(false);
	});

	it("lets every workspace member send texts, and nobody outside it", () => {
		for (const role of WORKSPACE_ROLES) expect(canSendSms(role)).toBe(true);
		expect(canSendSms(null)).toBe(false);
	});
});
