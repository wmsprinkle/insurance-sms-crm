import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { RecordField } from "../agent/lib/fields";
import { SMS_AGENT } from "../agent/lib/sms-config";
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
	it("match the knowledge-agency skill", () => {
		const text = readFileSync(
			new URL("../agent/skills/knowledge-agency.md", import.meta.url),
			"utf8",
		);
		const section = text.split("## Licensed states")[1]?.split("##")[0] ?? "";
		const listed = section.match(/\b[A-Z]{2}\b/g) ?? [];
		expect(listed).toEqual([...SMS_AGENT.licensedStates]);
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
