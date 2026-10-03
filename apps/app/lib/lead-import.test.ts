import { describe, expect, it } from "bun:test";
import {
	commitMapping,
	currentStep,
	importBlockReason,
	importLabel,
	mappingBlockers,
	missingRequiredFields,
	rejectionLabel,
	rowsForReview,
	stepStates,
	visibleRows,
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

describe("steps", () => {
	it("marks done, current and upcoming", () => {
		expect(stepStates("map").map((step) => step.state)).toEqual([
			"done",
			"current",
			"upcoming",
		]);
	});

	it("picks the step from the state", () => {
		expect(
			currentStep({ hasFile: false, hasPreview: false, wantsReview: true }),
		).toBe("upload");
		expect(
			currentStep({ hasFile: true, hasPreview: false, wantsReview: true }),
		).toBe("map");
		expect(
			currentStep({ hasFile: true, hasPreview: true, wantsReview: true }),
		).toBe("review");
		expect(
			currentStep({ hasFile: true, hasPreview: true, wantsReview: false }),
		).toBe("map");
	});
});

describe("mappingBlockers", () => {
	it("explains each gap in plain words", () => {
		const blockers = mappingBlockers({ phone: "Phone" });
		expect(blockers).toHaveLength(3);
		expect(blockers[2]).toContain("opt-in");
	});

	it("is empty for a complete mapping", () => {
		expect(mappingBlockers(complete)).toEqual([]);
	});
});

describe("import labels", () => {
	it("blocks at zero and pluralises", () => {
		expect(importBlockReason(0)).not.toBeNull();
		expect(importBlockReason(2)).toBeNull();
		expect(importLabel(1)).toBe("Import 1 lead");
		expect(importLabel(3)).toBe("Import 3 leads");
	});
});

describe("visibleRows", () => {
	const row = (
		rowNumber: number,
		status: "ready" | "rejected" | "duplicate",
	) => ({ rowNumber, status, phone: null, reasons: [], contactId: null });

	it("filters to problems", () => {
		const rows = [row(1, "ready"), row(2, "rejected"), row(3, "duplicate")];
		expect(visibleRows(rows, true).shown.map((r) => r.rowNumber)).toEqual([
			2, 3,
		]);
		expect(visibleRows(rows, false).total).toBe(3);
	});
});

describe("plain language reasons", () => {
	it("says what to add", () => {
		expect(rejectionLabel("missing_consent_source")).toContain(
			"Add a consent source",
		);
	});
});
