import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { isLoopbackUrl, LOOPBACK_HOSTS } from "./dev-login";

export const DEV_LOGIN_PATH = "/dev-login";

export function devLoginPlugin(email: string) {
	return {
		id: "dev-login",
		endpoints: {
			devLogin: createAuthEndpoint(
				DEV_LOGIN_PATH,
				{ method: "POST" },
				async (ctx) => {
					const origin = ctx.request?.headers.get("origin");
					const host = ctx.request ? new URL(ctx.request.url).hostname : null;
					if (
						!host ||
						!LOOPBACK_HOSTS.has(host) ||
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
