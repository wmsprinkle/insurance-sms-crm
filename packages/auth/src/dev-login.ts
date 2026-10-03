export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
	"localhost",
	"127.0.0.1",
	"[::1]",
]);

export type DevLoginSource = {
	DEV_LOGIN?: string;
	NODE_ENV?: string;
	ALLOWED_SIGN_IN?: string;
	apiUrl: string;
	appUrls: readonly string[];
};

export type DevLoginState =
	| { enabled: false }
	| { enabled: true; email: string };

export function isLoopbackUrl(value: string): boolean {
	try {
		return LOOPBACK_HOSTS.has(new URL(value).hostname);
	} catch {
		return false;
	}
}

export function firstAllowedAddress(
	allowed: string | undefined,
): string | undefined {
	for (const raw of (allowed ?? "").split(",")) {
		const entry = raw.trim().toLowerCase().replace(/^@/, "");
		if (entry.includes("@")) return entry;
	}
	return undefined;
}

export function resolveDevLogin(source: DevLoginSource): DevLoginState {
	if (source.DEV_LOGIN !== "true") return { enabled: false };

	if (source.NODE_ENV === "production") {
		throw new Error(
			"DEV_LOGIN=true is not allowed when NODE_ENV is production. Remove DEV_LOGIN from the environment.",
		);
	}

	const hosts = [source.apiUrl, ...source.appUrls];
	const remote = hosts.find((url) => !isLoopbackUrl(url));
	if (remote !== undefined) {
		throw new Error(
			`DEV_LOGIN=true is only allowed on localhost or 127.0.0.1. API_URL and APP_URL must both be local, but found ${remote}.`,
		);
	}

	const email = firstAllowedAddress(source.ALLOWED_SIGN_IN);
	if (!email) {
		throw new Error(
			'DEV_LOGIN=true needs a full email address in ALLOWED_SIGN_IN, for example ALLOWED_SIGN_IN="you@gmail.com". A domain alone is not enough.',
		);
	}

	return { enabled: true, email };
}

export function devLoginFromEnvironment(
	raw: Record<string, string | undefined>,
): DevLoginState {
	const appUrls = (raw.APP_URL || "http://localhost:3000")
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);

	return resolveDevLogin({
		DEV_LOGIN: raw.DEV_LOGIN,
		NODE_ENV: raw.NODE_ENV,
		ALLOWED_SIGN_IN: raw.ALLOWED_SIGN_IN,
		apiUrl: raw.API_URL || raw.BETTER_AUTH_URL || "http://localhost:3001",
		appUrls,
	});
}
