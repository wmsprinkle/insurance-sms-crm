import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { DEV_LOGIN_PATH, isLoopbackPeer, PEER_HEADER } from "./dev-login";
import { DEV_LOGIN_PROOF_HEADER, verifyDevLoginProof } from "./dev-login-proof";

export function devLoginPlugin(email: string, secret: string | undefined) {
	return {
		id: "dev-login",
		endpoints: {
			devLogin: createAuthEndpoint(
				DEV_LOGIN_PATH,
				{ method: "POST" },
				async (ctx) => {
					const headers = ctx.request?.headers;

					if (
						!headers ||
						!isLoopbackPeer(headers.get(PEER_HEADER)) ||
						!verifyDevLoginProof(secret, headers.get(DEV_LOGIN_PROOF_HEADER))
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
