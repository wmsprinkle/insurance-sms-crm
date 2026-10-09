export const SMS_ENV = {
	apiKey: "TELNYX_API_KEY",
	publicKey: "TELNYX_PUBLIC_KEY",
	messagingProfileId: "TELNYX_MESSAGING_PROFILE_ID",
	fromNumber: "TELNYX_FROM_NUMBER",
	messagesPerSecond: "TELNYX_MPS",
} as const;

export type SmsEnv = {
	apiKey: string | null;
	publicKey: string | null;
	messagingProfileId: string | null;
	fromNumber: string | null;
	messagesPerSecond: number | null;
	canSend: boolean;
};

type Source = Record<string, string | undefined>;

function text(source: Source, name: string): string | null {
	const value = source[name]?.trim();
	return value ? value : null;
}

function positiveNumber(source: Source, name: string): number | null {
	const value = text(source, name);
	if (value === null) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function readSmsEnv(source: Source = process.env): SmsEnv {
	const apiKey = text(source, SMS_ENV.apiKey);
	const fromNumber = text(source, SMS_ENV.fromNumber);

	return {
		apiKey,
		publicKey: text(source, SMS_ENV.publicKey),
		messagingProfileId: text(source, SMS_ENV.messagingProfileId),
		fromNumber,
		messagesPerSecond: positiveNumber(source, SMS_ENV.messagesPerSecond),
		canSend: apiKey !== null && fromNumber !== null,
	};
}
