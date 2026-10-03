import type { SmsEnv } from "@crm/env/sms";

type Source = Record<string, string | undefined>;

export const SETUP = {
	defaultApiUrl: "http://localhost:3001",
	webhookPath: "/webhooks/telnyx",
	modelKeyVariables: [
		"AI_GATEWAY_API_KEY",
		"VERCEL_OIDC_TOKEN",
		"ANTHROPIC_API_KEY",
	],
	visibleDigits: 4,
	hiddenMask: "***",
} as const;

export function maskPhone(phone: string | null): string | null {
	if (!phone) return null;

	const digits = phone.replace(/\D/g, "");
	if (digits.length <= SETUP.visibleDigits) return null;

	const tail = digits.slice(-SETUP.visibleDigits);
	const national =
		digits.length === 11 && digits.startsWith("1")
			? digits.slice(1)
			: digits.length === 10
				? digits
				: null;

	if (national) {
		return `+1 ${national.slice(0, 3)} ${SETUP.hiddenMask} ${tail}`;
	}

	return `+${digits.slice(0, 2)} ${SETUP.hiddenMask} ${tail}`;
}

export function webhookUrl(source: Source): string {
	const base = source.API_URL?.trim() || SETUP.defaultApiUrl;

	return `${base.replace(/\/+$/, "")}${SETUP.webhookPath}`;
}

export function modelKeySet(source: Source): boolean {
	return SETUP.modelKeyVariables.some((name) => Boolean(source[name]?.trim()));
}

export type SetupFacts = {
	telnyxConfigured: boolean;
	telnyxApiKeySet: boolean;
	telnyxNumberSet: boolean;
	telnyxProfileSet: boolean;
	webhookKeySet: boolean;
	fromNumberMasked: string | null;
	modelKeySet: boolean;
	webhookUrl: string;
};

export function describeSetup(sms: SmsEnv, source: Source): SetupFacts {
	return {
		telnyxConfigured: Boolean(
			sms.apiKey && sms.fromNumber && sms.messagingProfileId,
		),
		telnyxApiKeySet: sms.apiKey !== null,
		telnyxNumberSet: sms.fromNumber !== null,
		telnyxProfileSet: sms.messagingProfileId !== null,
		webhookKeySet: sms.publicKey !== null,
		fromNumberMasked: maskPhone(sms.fromNumber),
		modelKeySet: modelKeySet(source),
		webhookUrl: webhookUrl(source),
	};
}
