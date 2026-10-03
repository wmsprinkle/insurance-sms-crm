import { describe, expect, it } from "bun:test";
import {
	commitMapping,
	missingRequiredFields,
	rejectionLabel,
	rowsForReview,
	withColumn,
} from "./lead-import";

const complete = {
	phone: "Phone",
	consentSource: "Source",
	consentCapturedAt: "Opted in",
	optInUrl: "Form",
};

describe("missingRequiredFields", () => {
	it("names the unmapped required fields", () => {
		expect(missingRequiredFields({ phone: "Phone" })).toEqual([
			"consentSource",
			"consentCapturedAt",
		]);
	});
});

describe("commitMapping", () => {
	it("accepts a complete mapping", () => {
		expect(commitMapping(complete)).toEqual(complete);
	});

	it("refuses a mapping without opt-in evidence", () => {
		expect(commitMapping({ ...complete, optInUrl: undefined })).toBeNull();
	});
});

describe("withColumn", () => {
	it("removes a field set to no column", () => {
		expect(withColumn(complete, "optInUrl", null)).not.toHaveProperty(
			"optInUrl",
		);
	});
});

describe("rowsForReview", () => {
	it("puts rejected rows first, then by row number", () => {
		const row = (rowNumber: number, status: "ready" | "rejected") => ({
			rowNumber,
			status,
			phone: null,
			reasons: [],
			contactId: null,
		});
		expect(
			rowsForReview([
				row(2, "ready"),
				row(5, "rejected"),
				row(3, "rejected"),
			]).map((entry) => entry.rowNumber),
		).toEqual([3, 5, 2]);
	});
});

describe("rejectionLabel", () => {
	it("explains a duplicate phone", () => {
		expect(rejectionLabel("duplicate_phone")).toMatch(/already/);
	});
});
