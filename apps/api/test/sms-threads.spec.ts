import { describe, expect, it } from "bun:test";
import {
	contactDisplayName,
	previewOf,
	threadSearch,
} from "../src/sms/sms-threads";

describe("contactDisplayName", () => {
	it("joins first and last name", () => {
		expect(contactDisplayName({ firstName: "Ana", lastName: "Ruiz" })).toBe(
			"Ana Ruiz",
		);
	});

	it("drops a missing last name", () => {
		expect(contactDisplayName({ firstName: "Ana", lastName: null })).toBe(
			"Ana",
		);
	});
});

describe("previewOf", () => {
	it("flattens whitespace", () => {
		expect(previewOf("a\n\n  b", 10)).toBe("a b");
	});

	it("cuts long text with an ellipsis", () => {
		expect(previewOf("abcdefghij", 5)).toBe("abcd…");
	});
});

describe("threadSearch", () => {
	it("only excludes archived contacts without a term", () => {
		expect(threadSearch("  ")).toEqual({ archivedAt: null });
	});

	it("searches names and the digits of a phone", () => {
		expect(threadSearch("(555) 01")).toEqual({
			archivedAt: null,
			OR: [
				{ firstName: { contains: "(555) 01", mode: "insensitive" } },
				{ lastName: { contains: "(555) 01", mode: "insensitive" } },
				{ phone: { contains: "55501" } },
			],
		});
	});

	it("does not search phones for a name", () => {
		expect(threadSearch("ana").OR).toHaveLength(2);
	});
});
