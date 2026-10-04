import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
	DEV_LOGIN_PATH,
	isLoopbackRequest,
	isLoopbackUrl,
	PEER_HEADER,
} from "./dev-login";

export function devLoginPlugin(email: string) {
	return {
		id: "dev-login",
		endpoints: {
			devLogin: createAuthEndpoint(
				DEV_LOGIN_PATH,
				{ method: "POST" },
				async (ctx) => {
					const headers = ctx.request?.headers;
					const origin = headers?.get("origin");

					if (
						!headers ||
						!isLoopbackRequest({
							peer: headers.get(PEER_HEADER),
							host: headers.get("host"),
							headerNames: [...headers.keys()].filter(
								(name) => name !== PEER_HEADER,
							),
						}) ||
						(origin && !isLoopbackUrl(origin))
					) {
						throw ctx.error("FORBIDDEN", {
							message: "Dev sign-in answers only on localhost.",
						});
					}

					const adapter = ctx.context.internalAdapter;
					const existing = await adapter.findUserByEmail(email);
					const user =
						existing?.user ??
						(await adapter.createUser({
							email,
							name: email.split("@")[0] ?? email,
							emailVerified: true,
						}));

					const session = await adapter.createSession(user.id);
					await setSessionCookie(ctx, { session, user });

					return ctx.json({ ok: true });
				},
			),
		},
	};
}
