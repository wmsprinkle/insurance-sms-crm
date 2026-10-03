import { describe, expect, it } from "bun:test";
import { parseCsv } from "../../api/src/leads/csv";
import { suggestMapping } from "../../api/src/leads/lead-csv";
import { previewCsv } from "./csv-preview";
import { missingRequiredFields } from "./lead-import";
import { SAMPLE_LEADS, sampleLeadsCsv } from "./sample-leads-csv";

describe("sample leads csv", () => {
	it("maps every required field from its headers", () => {
		const mapping = suggestMapping([...SAMPLE_LEADS.headers]);
		expect(missingRequiredFields(mapping)).toEqual([]);
		expect(mapping.optInText).toBe("opt_in_text");
	});

	it("parses with the API parser into four rows", () => {
		expect(parseCsv(sampleLeadsCsv()).rows).toHaveLength(4);
	});

	it("keeps quoted commas and quotes in the preview", () => {
		const preview = previewCsv(sampleLeadsCsv(), 10);
		expect(preview.rows[3]?.[6]).toBe(
			'I agree to get texts, including "quote" follow-ups, from Acme Insurance.',
		);
		expect(preview.headers).toHaveLength(9);
	});
});
