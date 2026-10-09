import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
import {
	devLoginFromEnvironment,
	isLoopbackAppRequest,
} from "@crm/auth/dev-login";
import { Skeleton } from "@crm/ui/components/skeleton";
import { getSessionCookie } from "better-auth/cookies";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { getSession } from "@/lib/session";
import { getPublicTrpcClient } from "@/lib/trpc/server";
import { DevSignIn } from "./dev-sign-in";
import { type SocialProviderId, SocialSignIn } from "./social-sign-in";
import { type SsoProvider, SsoSignIn } from "./sso-sign-in";

export const metadata: Metadata = {
	title: "Sign in",
};

type SignInOptions = {
	google: boolean;
	microsoft: boolean;
	auth0: boolean;
	providers: SsoProvider[];
};

async function fetchSignInOptions(): Promise<SignInOptions> {
	"use cache";
	cacheLife({ stale: 60, revalidate: 60, expire: 600 });
	return getPublicTrpcClient().sso.signInOptions.query();
}

async function signInOptions(): Promise<SignInOptions | null> {
	try {
		return await fetchSignInOptions();
	} catch (error) {
		unstable_rethrow(error);
		console.error("Sign-in: could not read the sign-in options.", error);
		return null;
	}
}

async function currentSession(requestHeaders: Headers) {
	if (
		getSessionCookie(requestHeaders, { cookiePrefix: AUTH_COOKIE_PREFIX }) ===
		null
	) {
		return null;
	}

	try {
		return await getSession();
	} catch (error) {
		unstable_rethrow(error);
		console.error("Sign-in: could not read the session.", error);
		return null;
	}
}

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
	return (
		<AuthShell preview>
			<Suspense
				fallback={
					<>
						<AuthHeading
							title="Welcome back"
							description="Sign in with your account to continue."
						/>
						<Skeleton className="h-9 w-full" />
					</>
				}
			>
				<SignIn searchParams={searchParams} />
			</Suspense>
		</AuthShell>
	);
}

async function SignIn({
	searchParams,
}: Pick<PageProps<"/sign-in">, "searchParams">) {
	const requestHeaders = await headers();
	const [session, options, { method }] = await Promise.all([
		currentSession(requestHeaders),
		signInOptions(),
		searchParams,
	]);

	if (session) {
		redirect("/");
	}

	const configured: SocialProviderId[] = [];
	if (options?.auth0 ?? false) configured.push("auth0");
	if (options?.google ?? false) configured.push("google");
	if (options?.microsoft ?? false) configured.push("microsoft");

	const configuredDevLogin = devLoginFromEnvironment(process.env);
	const devLogin =
		configuredDevLogin.enabled && isLoopbackAppRequest(requestHeaders)
			? configuredDevLogin
			: ({ enabled: false } as const);

	const providers = options?.providers ?? [];

	const insisted = configured.find((provider) => provider === method);
	const showSso = providers.length > 0 && insisted === undefined;
	const social =
		insisted !== undefined
			? [insisted]
			: providers.length === 0
				? configured
				: [];

	if (!showSso && social.length === 0 && !devLogin.enabled) {
		return (
			<>
				<AuthHeading
					title="No way in yet"
					description="This app has no sign-in method configured, so nobody can get in — including you."
				/>

				<p className="mx-auto max-w-[40ch] text-center text-muted-foreground text-sm/5">
					Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, MICROSOFT_CLIENT_ID and
					MICROSOFT_CLIENT_SECRET, or AUTH0_DOMAIN, AUTH0_CLIENT_ID and
					AUTH0_CLIENT_SECRET in the root .env file and restart. Steps:
					docs/OAUTH_SETUP.md.
				</p>
			</>
		);
	}

	return (
		<>
			<AuthHeading
				title="Welcome back"
				description="Sign in with your account to continue."
			/>

			{showSso ? <SsoSignIn providers={providers} /> : null}
			{social.map((provider) => (
				<SocialSignIn key={provider} provider={provider} />
			))}
			{devLogin.enabled ? (
				<DevSignIn
					email={devLogin.email}
					primary={!showSso && social.length === 0}
				/>
			) : null}
		</>
	);
}
