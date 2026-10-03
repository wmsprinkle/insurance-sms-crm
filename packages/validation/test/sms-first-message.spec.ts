import { describe, expect, it } from "bun:test";
import { buildFirstMessage, cleanFirstName } from "../src/sms-first-message";

const OFF = { brand: "Acme Insurance", brandPrefix: false, stopFooter: false };

describe("buildFirstMessage", () => {
	it("is exactly the owner's text by default", () => {
		expect(buildFirstMessage({ ...OFF, firstName: "Ana" })).toBe(
			"Hello Ana, Are you interested in life or health coverage?",
		);
	});

	it("has no brand and no STOP footer by default", () => {
		const text = buildFirstMessage({ ...OFF, firstName: "Ana" });
		expect(text).not.toContain("Acme");
		expect(text).not.toMatch(/stop/i);
	});

	it("falls back to there when the name is missing", () => {
		for (const firstName of [null, undefined, "", "   ", "\n"]) {
			expect(buildFirstMessage({ ...OFF, firstName })).toBe(
				"Hello there, Are you interested in life or health coverage?",
			);
		}
	});

	it("adds the brand prefix only when asked", () => {
		expect(
			buildFirstMessage({ ...OFF, firstName: "Ana", brandPrefix: true }),
		).toBe(
			"Acme Insurance: Hello Ana, Are you interested in life or health coverage?",
		);
	});

	it("adds the STOP footer only when asked", () => {
		expect(
			buildFirstMessage({ ...OFF, firstName: "Ana", stopFooter: true }),
		).toBe(
			"Hello Ana, Are you interested in life or health coverage? Reply STOP to opt out.",
		);
	});

	it("adds both when both are on", () => {
		expect(
			buildFirstMessage({
				firstName: "Ana",
				brand: "Acme Insurance",
				brandPrefix: true,
				stopFooter: true,
			}),
		).toBe(
			"Acme Insurance: Hello Ana, Are you interested in life or health coverage? Reply STOP to opt out.",
		);
	});

	it("skips an empty brand even when the prefix is on", () => {
		expect(
			buildFirstMessage({
				firstName: "Ana",
				brand: "  ",
				brandPrefix: true,
				stopFooter: false,
			}),
		).toBe("Hello Ana, Are you interested in life or health coverage?");
	});

	it("fits in one text segment", () => {
		expect(
			buildFirstMessage({ ...OFF, firstName: "Maximiliana" }).length,
		).toBeLessThan(160);
	});
});

describe("cleanFirstName", () => {
	it("title-cases and trims", () => {
		expect(cleanFirstName("  jOHN ")).toBe("John");
		expect(cleanFirstName("ANA")).toBe("Ana");
		expect(cleanFirstName("mary-ann")).toBe("Mary-Ann");
		expect(cleanFirstName("o'neil")).toBe("O'Neil");
		expect(cleanFirstName("josé")).toBe("José");
		expect(cleanFirstName("mary  jo")).toBe("Mary Jo");
	});

	it("drops digits, symbols, links and emoji", () => {
		expect(cleanFirstName("Ana123")).toBe("Ana");
		expect(cleanFirstName("Ana 😀")).toBe("Ana");
		expect(cleanFirstName("<b>Ana</b>")).toBe("Ana");
		expect(cleanFirstName("12345")).toBe("there");
		expect(cleanFirstName("😀")).toBe("there");
	});

	it("treats placeholder names as missing", () => {
		for (const name of ["N/A", "n/a", "unknown", "null", "None", "-"]) {
			expect(cleanFirstName(name)).toBe("there");
		}
	});

	it("caps a very long name", () => {
		expect(cleanFirstName("a".repeat(200)).length).toBeLessThanOrEqual(40);
	});
});
