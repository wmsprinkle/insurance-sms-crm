import { z } from "zod";

export const SMS_DISCLOSURE_MODES = ["disclose", "deflect"] as const;

export const SMS_AMBIGUOUS_MODES = ["human", "llm"] as const;

export type SmsAmbiguousMode = (typeof SMS_AMBIGUOUS_MODES)[number];

export type SmsDisclosureMode = (typeof SMS_DISCLOSURE_MODES)[number];

export const SMS_SETTINGS_LIMITS = {
	firstMessage: { minLength: 20, maxLength: 320 },
	replyTone: { maxLength: 300 },
	brandName: { maxLength: 80 },
	licensedStates: { maxCount: 60 },
} as const;

export const SMS_TEMPLATE_TOKENS = {
	firstName: "{firstName}",
	agency: "{agency}",
} as const;

export const SMS_BRAND_FALLBACK = "Our team";

export const DEFAULT_FIRST_MESSAGE_TEMPLATE =
	"Hello {firstName}, this is {agency}. Are you interested in life or health coverage? Reply STOP to opt out.";

export const DEFAULT_SMS_SETTINGS = {
	firstMessageTemplate: DEFAULT_FIRST_MESSAGE_TEMPLATE,
	disclosureMode: "disclose",
	autoSend: false,
	brandName: "",
	licensedStates: [] as string[],
	ambiguousMode: "human",
	replyTone: "",
} as const satisfies SmsSettings;

export const firstMessageTemplate = z
	.string()
	.trim()
	.min(
		SMS_SETTINGS_LIMITS.firstMessage.minLength,
		`The first message needs at least ${SMS_SETTINGS_LIMITS.firstMessage.minLength} characters.`,
	)
	.max(
		SMS_SETTINGS_LIMITS.firstMessage.maxLength,
		`The first message cannot be longer than ${SMS_SETTINGS_LIMITS.firstMessage.maxLength} characters.`,
	)
	.refine(
		(value) => value.includes(SMS_TEMPLATE_TOKENS.agency),
		`The first message must keep ${SMS_TEMPLATE_TOKENS.agency}. It becomes your business name.`,
	)
	.refine(
		(value) => /\bSTOP\b/.test(value),
		"The first message must tell the lead to reply STOP to opt out.",
	);

export const replyTone = z
	.string()
	.trim()
	.max(
		SMS_SETTINGS_LIMITS.replyTone.maxLength,
		`The reply tone cannot be longer than ${SMS_SETTINGS_LIMITS.replyTone.maxLength} characters.`,
	)
	.refine(
		(value) => !/[<>`]|https?:|www\./i.test(value),
		"The reply tone cannot hold a link, a tag or a code block.",
	);

export const brandName = z
	.string()
	.trim()
	.max(
		SMS_SETTINGS_LIMITS.brandName.maxLength,
		`The business name cannot be longer than ${SMS_SETTINGS_LIMITS.brandName.maxLength} characters.`,
	)
	.refine(
		(value) => !/[@/\\<>]|https?:|www\./i.test(value),
		"The business name cannot hold a link or an email address.",
	);

export const licensedStates = z
	.array(
		z
			.string()
			.trim()
			.toUpperCase()
			.regex(/^[A-Z]{2}$/, "A state is a two-letter US code."),
	)
	.max(
		SMS_SETTINGS_LIMITS.licensedStates.maxCount,
		`List at most ${SMS_SETTINGS_LIMITS.licensedStates.maxCount} states.`,
	)
	.refine(
		(states) => new Set(states).size === states.length,
		"A state appears twice.",
	);

export const smsSettings = z.object({
	firstMessageTemplate,
	disclosureMode: z.enum(SMS_DISCLOSURE_MODES),
	autoSend: z.boolean(),
	brandName,
	licensedStates,
	ambiguousMode: z.enum(SMS_AMBIGUOUS_MODES).default("human"),
	replyTone: replyTone.default(""),
});

export type SmsSettings = z.infer<typeof smsSettings>;

const storedSmsSettings = smsSettings.partial();

export function parseSmsSettings(value: unknown): SmsSettings {
	if (value === null || value === undefined) {
		return { ...DEFAULT_SMS_SETTINGS };
	}
	const parsed = storedSmsSettings.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`Unreadable sms settings: ${parsed.error.issues
				.map((issue) => `${issue.path.join(".") || "sms"} ${issue.message}`)
				.join("; ")}`,
		);
	}
	return { ...DEFAULT_SMS_SETTINGS, ...parsed.data };
}

export function resolveBrand(
	brandName: string,
	workspaceName: string | null | undefined,
): string {
	return brandName.trim() || workspaceName?.trim() || SMS_BRAND_FALLBACK;
}
