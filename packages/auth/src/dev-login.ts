export const DEV_LOGIN_PATH = "/dev-login";

export const DEV_LOGIN_APP_PATH = "/api/auth/dev-login";

export const DEV_LOGIN_ORIGINS: readonly string[] = [
	"http://localhost:3000",
	"http://127.0.0.1:3000",
];

export const PEER_HEADER = "x-crm-peer";

export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
	"localhost",
	"127.0.0.1",
	"[::1]",
]);

const LOOPBACK_PEERS: ReadonlySet<string> = new Set([
	"127.0.0.1",
	"::1",
	"0:0:0:0:0:0:0:1",
	"::ffff:127.0.0.1",
	"::ffff:7f00:1",
]);

const FORWARDING_EXACT: ReadonlySet<string> = new Set([
	"forwarded",
	"x-real-ip",
	"true-client-ip",
	"via",
	"x-original-forwarded-for",
	"x-original-host",
]);

const FORWARDING_PREFIXES: readonly string[] = [
	"x-forwarded-",
	"ngrok-",
	"cf-",
];

const FRAMEWORK_FORWARDING: ReadonlySet<string> = new Set([
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-port",
	"x-forwarded-proto",
]);

const PORT = /^\d{1,5}$/;

const APP_LISTENER_PEER = "127.0.0.1";

export type DevLoginSource = {
	DEV_LOGIN?: string;
	ALLOWED_SIGN_IN?: string;
};

export type DevLoginState =
	| { enabled: false }
	| { enabled: true; email: string };

export type LoopbackRequest = {
	peer: string | null | undefined;
	host: string | null | undefined;
	headerNames: Iterable<string>;
};

export const DEV_LOGIN_WARNING =
	"DEV_LOGIN is ON. The 'Continue as' sign-in works only for requests that come straight from this machine to localhost or 127.0.0.1 with no proxy or tunnel headers. Requests through the public URL are refused. Never set DEV_LOGIN on a shared server.";

export function isLoopbackUrl(value: string): boolean {
	try {
		return LOOPBACK_HOSTS.has(new URL(value).hostname);
	} catch {
		return false;
	}
}

export function isLoopbackPeer(peer: string | null | undefined): boolean {
	if (!peer) return false;
	return LOOPBACK_PEERS.has(peer.trim().toLowerCase());
}

export function loopbackHostname(
	host: string | null | undefined,
): string | undefined {
	if (!host) return undefined;

	const value = host.trim().toLowerCase();
	if (value === "" || /[\s,/@\\?#%]/.test(value)) return undefined;

	let name = value;
	let port: string | undefined;

	if (value.startsWith("[")) {
		const end = value.indexOf("]");
		if (end === -1) return undefined;
		name = value.slice(0, end + 1);
		const rest = value.slice(end + 1);
		if (rest !== "") {
			if (!rest.startsWith(":")) return undefined;
			port = rest.slice(1);
		}
	} else {
		const colon = value.indexOf(":");
		if (colon !== -1) {
			if (value.indexOf(":", colon + 1) !== -1) return undefined;
			name = value.slice(0, colon);
			port = value.slice(colon + 1);
		}
	}

	if (port !== undefined && !PORT.test(port)) return undefined;

	return LOOPBACK_HOSTS.has(name) ? name : undefined;
}

export function forwardingHeaderNames(headerNames: Iterable<string>): string[] {
	const found: string[] = [];
	for (const raw of headerNames) {
		const name = raw.trim().toLowerCase();
		if (
			FORWARDING_EXACT.has(name) ||
			FORWARDING_PREFIXES.some((prefix) => name.startsWith(prefix))
		) {
			found.push(name);
		}
	}
	return found;
}

export function isLoopbackRequest(request: LoopbackRequest): boolean {
	if (!isLoopbackPeer(request.peer)) return false;
	if (loopbackHostname(request.host) === undefined) return false;
	return forwardingHeaderNames(request.headerNames).length === 0;
}

export type HeaderReader = {
	get(name: string): string | null;
	keys(): Iterable<string>;
};

function listIsLoopback(
	value: string | null,
	accepts: (item: string) => boolean,
): boolean {
	if (value === null) return true;
	const items = value.split(",").map((item) => item.trim());
	return (
		items.length > 0 && items.every((item) => item !== "" && accepts(item))
	);
}

export function isLoopbackAppRequest(headers: HeaderReader): boolean {
	const forwardedFor = headers.get("x-forwarded-for");
	const forwardedHost = headers.get("x-forwarded-host");

	if (
		!listIsLoopback(forwardedFor, (item) => isLoopbackPeer(stripBrackets(item)))
	) {
		return false;
	}
	if (
		!listIsLoopback(
			forwardedHost,
			(item) => loopbackHostname(item) !== undefined,
		)
	) {
		return false;
	}

	const host = headers.get("host");
	const names = [...headers.keys()].filter(
		(name) => !FRAMEWORK_FORWARDING.has(name.trim().toLowerCase()),
	);

	return isLoopbackRequest({
		peer: APP_LISTENER_PEER,
		host,
		headerNames: names,
	});
}

function stripBrackets(value: string): string {
	return value.startsWith("[") && value.endsWith("]")
		? value.slice(1, -1)
		: value;
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

	const entries = (source.ALLOWED_SIGN_IN ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

	const email =
		entries.length === 1 ? firstAllowedAddress(entries[0]) : undefined;
	if (!email || email.split("@").length !== 2) {
		throw new Error(
			'DEV_LOGIN=true needs exactly one full email address in ALLOWED_SIGN_IN, for example ALLOWED_SIGN_IN="you@gmail.com". A domain or a list is not enough.',
		);
	}

	return { enabled: true, email };
}

export function devLoginFromEnvironment(
	raw: Record<string, string | undefined>,
): DevLoginState {
	return resolveDevLogin({
		DEV_LOGIN: raw.DEV_LOGIN,
		ALLOWED_SIGN_IN: raw.ALLOWED_SIGN_IN,
	});
}
