import { renderFirstMessage } from "@crm/validation/sms-first-message";
import {
	brandName,
	firstMessageTemplate,
	licensedStates,
	replyTone,
	resolveBrand,
	type SmsAmbiguousMode,
	type SmsDisclosureMode,
	type SmsSettings,
} from "@crm/validation/sms-settings";

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

export const PREVIEW_FIRST_NAME = "Alex";

export const SMS_CHOICES = {
	autoSend: {
		approve: {
			label: "Approve first",
			effect:
				"Every reply the assistant writes waits in Inbox, then Drafts. Nothing goes out until you approve it.",
		},
		auto: {
			label: "Send automatically",
			effect:
				"Replies go out at once, with no review, but only inside the allowed hours.",
		},
	},
	ambiguous: {
		human: {
			label: "Send to me",
			effect:
				"A reply the assistant cannot sort stops the conversation and appears under Needs you.",
		},
		llm: {
			label: "Let the assistant answer",
			effect:
				"The assistant answers an unclear reply on its own. You still see every message in the thread.",
		},
	},
	disclosure: {
		disclose: {
			label: "Say it is an automated assistant",
			effect: "Some states require this. It is the safe default.",
		},
		deflect: {
			label: "Steer back to the topic",
			effect:
				"The assistant does not claim to be human, and does not confirm it is a bot.",
		},
	},
} as const satisfies {
	autoSend: Record<"approve" | "auto", { label: string; effect: string }>;
	ambiguous: Record<SmsAmbiguousMode, { label: string; effect: string }>;
	disclosure: Record<SmsDisclosureMode, { label: string; effect: string }>;
};

export function autoSendChoice(autoSend: boolean): "approve" | "auto" {
	return autoSend ? "auto" : "approve";
}

export function firstMessagePreview(
	settings: Pick<SmsSettings, "brandName" | "firstMessageTemplate">,
	workspaceName: string | null | undefined,
): string {
	return renderFirstMessage({
		template: settings.firstMessageTemplate,
		firstName: PREVIEW_FIRST_NAME,
		brand: resolveBrand(settings.brandName, workspaceName),
	});
}

export function firstMessageProblem(value: string): string | null {
	const parsed = firstMessageTemplate.safeParse(value);
	return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
}

export function replyToneProblem(value: string): string | null {
	const parsed = replyTone.safeParse(value);
	return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
}

export function sameSmsSettings(a: SmsSettings, b: SmsSettings): boolean {
	return (
		a.firstMessageTemplate === b.firstMessageTemplate &&
		a.disclosureMode === b.disclosureMode &&
		a.autoSend === b.autoSend &&
		a.brandName === b.brandName &&
		a.ambiguousMode === b.ambiguousMode &&
		a.replyTone === b.replyTone &&
		a.licensedStates.join() === b.licensedStates.join()
	);
}

export function brandProblem(value: string): string | null {
	const parsed = brandName.safeParse(value);
	return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
}
