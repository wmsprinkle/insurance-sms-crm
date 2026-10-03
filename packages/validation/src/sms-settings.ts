import { z } from "zod";

export const SMS_DISCLOSURE_MODES = ["disclose", "deflect"] as const;

export type SmsDisclosureMode = (typeof SMS_DISCLOSURE_MODES)[number];

export const SMS_TEMPLATE_TOKENS = {
	firstName: "{firstName}",
	agency: "{agency}",
} as const;

export const SMS_SETTINGS_LIMITS = {
	firstMessage: { minLength: 20, maxLength: 320 },
} as const;

export const DEFAULT_FIRST_MESSAGE_TEMPLATE =
	"Hi {firstName}, this is {agency}. You asked us about an insurance quote, so we are following up here. Reply with any questions. Reply STOP to opt out.";

export const DEFAULT_SMS_SETTINGS = {
	firstMessageTemplate: DEFAULT_FIRST_MESSAGE_TEMPLATE,
	disclosureMode: "disclose",
	autoSend: false,
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
		(value) => /\bSTOP\b/.test(value),
		"The first message must tell the lead to reply STOP to opt out.",
	);

export const smsSettings = z.object({
	firstMessageTemplate,
	disclosureMode: z.enum(SMS_DISCLOSURE_MODES),
	autoSend: z.boolean(),
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

export function renderFirstMessage(
	template: string,
	values: { firstName: string | null; agency: string },
): string {
	const firstName = values.firstName?.trim() || "there";
	return template
		.replaceAll(SMS_TEMPLATE_TOKENS.firstName, firstName)
		.replaceAll(SMS_TEMPLATE_TOKENS.agency, values.agency.trim());
}
