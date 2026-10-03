import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
	DISCLOSURE_MODES,
	stripContactInfo,
} from "../agent/hooks/outbound-guard";

const SKILLS_DIR = join(import.meta.dir, "../agent/skills");
const KNOWLEDGE_MAX_CHARS = 9000;
const SMS_SKILLS = ["sms-conduct", "qualification", "compliance"];
const CLASSIFY_VALUES = [
	"opt_out",
	"wrong_number",
	"needs_human",
	"not_interested",
	"qualified",
	"interested",
	"question",
];

function skill(name: string): string {
	return readFileSync(join(SKILLS_DIR, `${name}.md`), "utf8");
}

function knowledgeSkills(): string[] {
	return readdirSync(SKILLS_DIR)
		.filter((file) => file.startsWith("knowledge-") && file.endsWith(".md"))
		.map((file) => file.slice(0, -3));
}

function description(markdown: string): string | null {
	const match = /^---\ndescription: (.+)\n---\n/.exec(markdown);
	return match?.[1] ?? null;
}

function body(markdown: string): string {
	return markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
}

describe("sms skills", () => {
	it.each([...SMS_SKILLS, ...knowledgeSkills()])(
		"%p routes on a description",
		(name) => {
			expect(description(skill(name))).toStartWith("Use ");
		},
	);

	it("sms-conduct keeps every numbered rule from 1 to 13", () => {
		const text = skill("sms-conduct");
		for (let rule = 1; rule <= 13; rule += 1) {
			expect(text).toMatch(new RegExp(`^\\s*${rule}\\. `, "m"));
		}
	});

	it("sms-conduct describes every disclosure mode the guard accepts", () => {
		const text = skill("sms-conduct");
		for (const mode of DISCLOSURE_MODES) {
			expect(text).toContain(`Disclosure mode: ${mode}`);
			expect(text).toContain(`**${mode}**`);
		}
		expect(text).toContain("never claim to be human");
	});

	it("qualification lists exactly the classify values", () => {
		const text = skill("qualification");
		const table = text.slice(
			text.indexOf("## Classify first"),
			text.indexOf("### Opt-out is meaning"),
		);
		const rows = [...table.matchAll(/^\| `([a-z_]+)` \|/gm)].map(
			(row) => row[1],
		);
		expect(rows).toEqual(CLASSIFY_VALUES);
	});

	it("qualification makes free-text opt-out an opt_out", () => {
		const text = skill("qualification");
		const optOut = text.slice(
			text.indexOf("### Opt-out is meaning"),
			text.indexOf('### "No" is not a refusal'),
		);
		expect(optOut).toContain("please don't text me");
		expect(optOut).toContain("Each of these is `opt_out`");
	});

	it("qualification never reads 'no problem, tell me more' as cold", () => {
		expect(skill("qualification")).toContain(
			'| "no problem, tell me more" | `interested` |',
		);
	});

	it("knowledge stays under the prompt cap", () => {
		const total = knowledgeSkills()
			.map((name) => body(skill(name)).length)
			.reduce((sum, length) => sum + length, 0);
		expect(total).toBeLessThanOrEqual(KNOWLEDGE_MAX_CHARS);
	});

	it.each(knowledgeSkills())("%p holds no contact details", (name) => {
		const text = body(skill(name)).replace(/\s+/g, " ").trim();
		expect(stripContactInfo(text, null)).toBe(text);
	});
});
