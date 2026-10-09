import { describe, expect, it } from "bun:test";
import { cleanFirstName, renderFirstMessage } from "../src/sms-first-message";
import { DEFAULT_FIRST_MESSAGE_TEMPLATE } from "../src/sms-settings";

const TEMPLATE = DEFAULT_FIRST_MESSAGE_TEMPLATE;

describe("renderFirstMessage", () => {
	it("fills the name and the business name into the default wording", () => {
		expect(
			renderFirstMessage({
				template: TEMPLATE,
				firstName: "Ana",
				brand: "Acme Insurance",
			}),
		).toBe(
			"Hello Ana, this is Acme Insurance. Are you interested in life or health coverage? Reply STOP to opt out.",
		);
	});

	it("falls back to there when the name is missing", () => {
		for (const firstName of [null, undefined, "", "   ", "\n"]) {
			expect(
				renderFirstMessage({ template: TEMPLATE, firstName, brand: "Acme" }),
			).toContain("Hello there,");
		}
	});

	it("uses the wording the owner wrote", () => {
		expect(
			renderFirstMessage({
				template:
					"{agency} here. Hi {firstName}, still need a quote? Reply STOP to opt out.",
				firstName: "ana",
				brand: " Acme ",
			}),
		).toBe("Acme here. Hi Ana, still need a quote? Reply STOP to opt out.");
	});

	it("fills a token that appears twice", () => {
		expect(
			renderFirstMessage({
				template: "{agency}: {firstName}, it is {agency}. Reply STOP.",
				firstName: "Ana",
				brand: "Acme",
			}),
		).toBe("Acme: Ana, it is Acme. Reply STOP.");
	});

	it("cannot be steered by a hostile first name", () => {
		const text = renderFirstMessage({
			template: TEMPLATE,
			firstName: "{agency}<script>",
			brand: "Acme",
		});
		expect(text).not.toContain("<");
		expect(text).not.toContain("{");
	});

	it("fits in one text segment with the default wording", () => {
		expect(
			renderFirstMessage({
				template: TEMPLATE,
				firstName: "Maximiliana",
				brand: "Acme Insurance",
			}).length,
		).toBeLessThan(200);
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
