import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
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

	const providers = options?.providers ?? [];

	const insisted = configured.find((provider) => provider === method);
	const showSso = providers.length > 0 && insisted === undefined;
	const social =
		insisted !== undefined
			? [insisted]
			: providers.length === 0
				? configured
				: [];

	if (!showSso && social.length === 0) {
		return (
			<>
				<AuthHeading
					title="Sign-in is not available yet"
					description="Sign-in has not been set up for this workspace. Ask the person who manages it to finish setup, then try again."
				/>
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
		</>
	);
}
