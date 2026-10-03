import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { judgeQualification } from "@crm/validation/sms-qualification";
import type { RecordField } from "../agent/lib/fields";
import { smsTurnMessage } from "../agent/lib/sms-pipeline";
import {
	factsFromFields,
	fieldKeyFor,
	QUALIFICATION_FIELDS,
} from "../agent/lib/sms-qualification";
import { smsSessionOf } from "../agent/lib/sms-session";

function field(
	key: string,
	type: RecordField["type"],
	value: RecordField["value"],
	options: string[] = [],
): RecordField {
	return {
		id: key,
		entity: "CONTACT",
		key,
		label: key,
		type,
		typeLabel: type,
		agentFilled: true,
		agentBrief: null,
		required: false,
		showOnSheet: true,
		showOnTable: false,
		showOnFilter: false,
		position: 0,
		archived: false,
		options: options.map((label, position) => ({
			id: `opt-${label}`,
			label,
			position,
		})),
		value,
	};
}

describe("qualification fields", () => {
	it("use stable keys", () => {
		expect(fieldKeyFor("line")).toBe("sms_line_of_insurance");
		expect(fieldKeyFor("ageBand")).toBe("sms_age_band");
		expect(fieldKeyFor("timeline")).toBe("sms_timeline");
	});

	it("read select options back as their labels", () => {
		const facts = factsFromFields([
			field(fieldKeyFor("line"), "SELECT", "opt-term_life", [
				...QUALIFICATION_FIELDS.line.options,
			]),
			field(fieldKeyFor("state"), "TEXT", "TX"),
			field(fieldKeyFor("timeline"), "SELECT", null, [
				...QUALIFICATION_FIELDS.timeline.options,
			]),
		]);
		expect(facts).toEqual({ line: "term_life", state: "TX" });
	});

	it("throw on a stored value outside the schema", () => {
		expect(() =>
			factsFromFields([field(fieldKeyFor("state"), "TEXT", "Texas")]),
		).toThrow(/state/);
	});
});

describe("licensed states", () => {
	const text = readFileSync(
		new URL("../agent/skills/knowledge-agency.md", import.meta.url),
		"utf8",
	);
	const section = text.split("## Licensed states")[1]?.split("##")[0] ?? "";

	it("are not hard coded in the knowledge-agency skill", () => {
		expect(section.match(/\b[A-Z]{2}\b/g) ?? []).toEqual([]);
	});

	it("tell the agent to read the Licensed states line of the task", () => {
		expect(section).toContain("`Licensed states:`");
		const turn = smsTurnMessage({
			inbound: ["hi"],
			history: [],
			disclosure: "disclose",
			bookingLink: null,
			brand: "Acme",
			identify: true,
			licensedStates: ["TX"],
		});
		expect(turn).toContain("Licensed states: TX");
	});

	it("disqualify a lead outside the configured states", () => {
		expect(judgeQualification({ state: "NY" }, ["TX", "FL"])).toMatchObject({
			status: "disqualified",
		});
		expect(judgeQualification({ state: "TX" }, ["TX", "FL"]).status).not.toBe(
			"disqualified",
		);
		expect(judgeQualification({ state: "NY" }, []).status).not.toBe(
			"disqualified",
		);
	});
});

describe("smsSessionOf", () => {
	const ctx = (attributes: Record<string, string>) => ({
		session: { auth: { current: { attributes }, initiator: null } },
	});

	it("reads an SMS task session", () => {
		expect(
			smsSessionOf(
				ctx({
					taskKind: "sms-reply",
					contactId: "c1",
					taskId: "t1",
					disclosure: "deflect",
				}),
			),
		).toEqual({
			contactId: "c1",
			taskKind: "sms-reply",
			taskId: "t1",
			bookingLink: null,
			disclosure: "deflect",
			identify: false,
		});
	});

	it("refuses a research session and a session with no contact", () => {
		expect(smsSessionOf(ctx({ taskKind: "identify", contactId: "c1" }))).toBe(
			null,
		);
		expect(smsSessionOf(ctx({ taskKind: "sms-reply" }))).toBe(null);
	});

	it("drops an unknown disclosure mode", () => {
		expect(
			smsSessionOf(
				ctx({ taskKind: "first-touch", contactId: "c1", disclosure: "lie" }),
			)?.disclosure,
		).toBeUndefined();
	});
});
