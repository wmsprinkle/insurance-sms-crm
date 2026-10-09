"use client";

import { signIn } from "@crm/auth/client";
import type { MailboxProviderId } from "@crm/auth/scopes";
import Auth0Logo from "@crm/ui/components/brand-logos/auth0";
import GoogleLogo from "@crm/ui/components/brand-logos/google";
import MicrosoftLogo from "@crm/ui/components/brand-logos/microsoft";
import { Button } from "@crm/ui/components/button";
import { Spinner } from "@crm/ui/components/spinner";
import type { FC, SVGProps } from "react";
import { useState } from "react";
import { toast } from "sonner";

type ProviderChoice = {
	label: string;
	Logo: FC<SVGProps<SVGSVGElement>>;
};

export type SocialProviderId = MailboxProviderId | "auth0";

const PROVIDERS = {
	auth0: { label: "Continue with Auth0", Logo: Auth0Logo },
	google: { label: "Continue with Google", Logo: GoogleLogo },
	microsoft: { label: "Continue with Microsoft", Logo: MicrosoftLogo },
} as const satisfies Record<SocialProviderId, ProviderChoice>;

export function SocialSignIn({ provider }: { provider: SocialProviderId }) {
	const [pending, setPending] = useState(false);

	const { label, Logo } = PROVIDERS[provider];

	function fail(message?: string) {
		setPending(false);
		toast.error(message ?? "Could not reach the sign-in service.");
	}

	async function handleClick() {
		setPending(true);

		const origin = window.location.origin;

		const callbacks = {
			callbackURL: `${origin}/`,
			errorCallbackURL: `${origin}/sign-in`,
		};

		const { error } =
			provider === "auth0"
				? await signIn.oauth2({ providerId: "auth0", ...callbacks })
				: await signIn.social({ provider, ...callbacks });

		if (error) fail(error.message);
	}

	return (
		<Button
			className="w-full"
			disabled={pending}
			onClick={() => {
				handleClick().catch(() => fail());
			}}
			type="button"
			variant="outline"
		>
			{pending ? (
				<Spinner data-icon="inline-start" />
			) : (
				<Logo data-icon="inline-start" className="size-4" />
			)}
			{label}
		</Button>
	);
}
