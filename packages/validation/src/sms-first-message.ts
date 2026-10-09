export const FIRST_MESSAGE = {
	fallbackName: "there",
	maxNameChars: 40,
	placeholderNames: ["n/a", "na", "none", "null", "undefined", "unknown", "-"],
} as const;

const NAME_CHARS = /[^\p{L}\p{M}\s'’.-]/gu;

function titleCase(name: string): string {
	return name
		.toLowerCase()
		.replace(/(^|[\s'’.-])(\p{L})/gu, (_, lead: string, letter: string) => {
			return `${lead}${letter.toUpperCase()}`;
		});
}

export function cleanFirstName(raw: string | null | undefined): string {
	const placeholder = (raw ?? "").trim().toLowerCase();
	if (
		(FIRST_MESSAGE.placeholderNames as readonly string[]).includes(placeholder)
	) {
		return FIRST_MESSAGE.fallbackName;
	}
	const flat = (raw ?? "")
		.normalize("NFKC")
		.replace(/<[^>]*>/g, " ")
		.replace(NAME_CHARS, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, FIRST_MESSAGE.maxNameChars)
		.trim();
	if (flat.replace(/[^\p{L}]/gu, "").length === 0) {
		return FIRST_MESSAGE.fallbackName;
	}
	return titleCase(flat);
}

export type FirstMessageInput = {
	template: string;
	firstName: string | null | undefined;
	brand: string;
};

export function renderFirstMessage(input: FirstMessageInput): string {
	return input.template
		.replaceAll("{firstName}", cleanFirstName(input.firstName))
		.replaceAll("{agency}", input.brand.trim())
		.replace(/\s+/g, " ")
		.trim();
}
