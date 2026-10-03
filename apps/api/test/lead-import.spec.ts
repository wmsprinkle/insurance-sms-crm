import { describe, expect, it } from "bun:test";
import { CsvParseError, parseCsv } from "../src/leads/csv";
import { checkRows, totalsOf, triage } from "../src/leads/lead-batch";
import {
	type LeadColumnMapping,
	mapRows,
	resolveMapping,
	suggestMapping,
} from "../src/leads/lead-csv";
import { checkLead } from "../src/leads/lead-validation";

const NOW = new Date("2026-10-03T12:00:00Z");

const consent = {
	consentSource: "web_form",
	consentCapturedAt: "2026-10-01T15:00:00Z",
	optInText: "I agree to receive texts about my quote.",
};

const none = { byPhone: new Map<string, string>(), byEmail: new Map() };

describe("parseCsv", () => {
	it("reads quoted cells, escaped quotes, CRLF and a BOM", () => {
		const table = parseCsv(
			'﻿Name,Phone,Note\r\n"Doe, Jane",(555) 201-0001,"said ""yes"""\r\n',
		);
		expect(table.headers).toEqual(["Name", "Phone", "Note"]);
		expect(table.rows).toEqual([
			{ rowNumber: 2, cells: ["Doe, Jane", "(555) 201-0001", 'said "yes"'] },
		]);
	});

	it("keeps true row numbers when blank lines are skipped", () => {
		const table = parseCsv("phone\n\n5552010001\n\n5552010002");
		expect(table.rows.map((row) => row.rowNumber)).toEqual([3, 5]);
	});

	it("keeps a newline inside a quoted cell", () => {
		const table = parseCsv('a,b\n"line 1\nline 2",x\n');
		expect(table.rows[0]?.cells).toEqual(["line 1\nline 2", "x"]);
	});

	it("rejects an unclosed quote and an empty file", () => {
		expect(() => parseCsv('a,b\n"open,x')).toThrow(CsvParseError);
		expect(() => parseCsv("\n\n")).toThrow(CsvParseError);
	});
});

describe("checkLead", () => {
	it("accepts a lead with consent and normalises phone and email", () => {
		const result = checkLead(
			{
				fullName: "Jane Q Doe",
				phone: "(555) 201-0001",
				email: " Jane@Example.com ",
				...consent,
			},
			NOW,
		);
		expect(result).toEqual({
			ok: true,
			lead: {
				firstName: "Jane",
				lastName: "Q Doe",
				email: "jane@example.com",
				phone: "+15552010001",
				consent: {
					source: "WEB_FORM",
					capturedAt: new Date("2026-10-01T15:00:00Z"),
					optInText: consent.optInText,
					optInUrl: null,
					ip: null,
				},
			},
		});
	});

	it("rejects a lead without consent and lists every reason", () => {
		const result = checkLead({ phone: "5552010001" }, NOW);
		expect(result).toEqual({
			ok: false,
			reasons: [
				"missing_consent_source",
				"missing_consent_date",
				"missing_opt_in_evidence",
			],
		});
	});

	it("rejects bad phone, unknown source, future date and bad URL", () => {
		const result = checkLead(
			{
				phone: "12345",
				consentSource: "bought_list",
				consentCapturedAt: "2026-11-01T00:00:00Z",
				optInUrl: "javascript:alert(1)",
			},
			NOW,
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reasons).toEqual([
			"invalid_phone",
			"invalid_consent_source",
			"consent_date_in_future",
			"invalid_opt_in_url",
		]);
	});

	it("accepts an opt-in URL instead of opt-in text", () => {
		const result = checkLead(
			{
				phone: "+1 555 201 0001",
				consentSource: "API",
				consentCapturedAt: "2026-10-02",
				optInUrl: "https://quotes.example.com/form",
			},
			NOW,
		);
		expect(result.ok).toBe(true);
	});

	it("falls back to the phone number when there is no name", () => {
		const result = checkLead({ phone: "5552010001", ...consent }, NOW);
		expect(result.ok && result.lead.firstName).toBe("+15552010001");
	});

	it("rejects an oversized field", () => {
		const result = checkLead(
			{ phone: "5552010001", ...consent, firstName: "x".repeat(501) },
			NOW,
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reasons).toContain("field_too_long");
	});
});

describe("column mapping", () => {
	it("suggests a mapping from common header names", () => {
		expect(
			suggestMapping([
				"First Name",
				"Last Name",
				"Mobile Phone",
				"E-mail",
				"Opt-in Source",
				"Consent Date",
				"Consent Text",
				"Form URL",
				"IP Address",
			]),
		).toEqual({
			firstName: "First Name",
			lastName: "Last Name",
			phone: "Mobile Phone",
			email: "E-mail",
			consentSource: "Opt-in Source",
			consentCapturedAt: "Consent Date",
			optInText: "Consent Text",
			optInUrl: "Form URL",
			consentIp: "IP Address",
		});
	});

	it("requires phone, consent source, consent date and opt-in evidence", () => {
		const result = resolveMapping(["phone"], { phone: "phone" });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues).toEqual([
			"Map a column to consentSource.",
			"Map a column to consentCapturedAt.",
			"Map an opt-in text column, an opt-in URL column, or both.",
		]);
	});

	it("names a mapped column that the CSV does not have", () => {
		const result = resolveMapping(["phone", "src", "at"], {
			phone: "phone",
			consentSource: "src",
			consentCapturedAt: "at",
			optInText: "text",
		});
		expect(result).toEqual({
			ok: false,
			issues: ['The CSV has no column "text".'],
		});
	});
});

describe("triage", () => {
	const mapping: LeadColumnMapping = {
		phone: "phone",
		email: "email",
		consentSource: "source",
		consentCapturedAt: "at",
		optInText: "text",
	};

	const table = parseCsv(
		[
			"phone,email,source,at,text",
			"5552010001,a@example.com,web_form,2026-10-01,I agree",
			"555-201-0001,b@example.com,web_form,2026-10-01,I agree",
			"5552010002,,,,",
			"5552010003,taken@example.com,lead_import,2026-10-01,I agree",
			"5552010004,,manual,2026-10-01,I agree",
		].join("\n"),
	);

	it("reports each row as ready, duplicate or rejected with reasons", () => {
		const outcome = triage(checkRows(mapRows(table, mapping), NOW), {
			byPhone: new Map([["+15552010004", "contact_existing"]]),
			byEmail: new Map([["taken@example.com", "contact_taken"]]),
		});

		expect(outcome.results).toEqual([
			{
				rowNumber: 2,
				phone: "+15552010001",
				status: "ready",
				reasons: [],
				contactId: null,
			},
			{
				rowNumber: 3,
				phone: "+15552010001",
				status: "duplicate",
				reasons: ["duplicate_in_batch"],
				contactId: null,
			},
			{
				rowNumber: 4,
				phone: null,
				status: "rejected",
				reasons: [
					"missing_consent_source",
					"missing_consent_date",
					"missing_opt_in_evidence",
				],
				contactId: null,
			},
			{
				rowNumber: 5,
				phone: "+15552010003",
				status: "duplicate",
				reasons: ["duplicate_email"],
				contactId: "contact_taken",
			},
			{
				rowNumber: 6,
				phone: "+15552010004",
				status: "duplicate",
				reasons: ["duplicate_phone"],
				contactId: "contact_existing",
			},
		]);
		expect(outcome.ready.map((row) => row.rowNumber)).toEqual([2]);
		expect(totalsOf(outcome.results)).toEqual({
			rows: 5,
			ready: 1,
			created: 0,
			duplicate: 3,
			rejected: 1,
		});
	});

	it("handles an empty batch", () => {
		expect(triage([], none)).toEqual({ results: [], ready: [] });
	});
});
