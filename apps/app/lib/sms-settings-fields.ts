import { licensedStates } from "@crm/validation/sms-settings";

const STATE_SEPARATOR = /[\s,;]+/;

export function parseStatesText(text: string): string[] {
	return text
		.split(STATE_SEPARATOR)
		.map((code) => code.trim().toUpperCase())
		.filter((code) => code.length > 0);
}

export function statesText(states: readonly string[]): string {
	return states.join(", ");
}

export function statesProblem(text: string): string | null {
	const parsed = licensedStates.safeParse(parseStatesText(text));
	return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
}

export function frequencyCapText(limits: {
	perDay: number;
	perWeek: number;
}): string {
	return `A lead gets at most ${limits.perDay} texts a day and ${limits.perWeek} a week while none of them gets an answer.`;
}
