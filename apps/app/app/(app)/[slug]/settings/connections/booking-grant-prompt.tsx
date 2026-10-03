"use client";

import Warning from "@carbon/icons-react/es/Warning";
import { authClient } from "@crm/auth/client";
import { SYNC_SCOPES } from "@crm/auth/scopes";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@crm/ui/components/alert";
import GoogleLogo from "@crm/ui/components/brand-logos/google";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { Spinner } from "@crm/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";

export function BookingGrantPrompt({ slug }: { slug: string }) {
	const [pending, setPending] = useState(false);

	function fail(message?: string) {
		setPending(false);
		toast.error(message ?? "Could not reach Google.");
	}

	async function grant() {
		setPending(true);
		const origin = window.location.origin;
		const { error } = await authClient.linkSocial({
			provider: "google",
			scopes: [...SYNC_SCOPES],
			callbackURL: `${origin}/${slug}/settings/connections`,
			errorCallbackURL: `${origin}/${slug}/settings/connections/google?provider=google`,
		});
		if (error) fail(error.message);
	}

	return (
		<Alert>
			<Icon icon={Warning} />
			<AlertTitle>Google needs one more permission</AlertTitle>
			<AlertDescription>
				The agent books meetings with leads on your calendar. Your Google
				connection was made before that, so it can read your calendar but cannot
				add events. Grant access once to turn booking on.
			</AlertDescription>
			<AlertAction>
				<Button
					size="sm"
					disabled={pending}
					onClick={() => {
						grant().catch(() => fail());
					}}
				>
					{pending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<GoogleLogo data-icon="inline-start" className="size-4" />
					)}
					Grant calendar access
				</Button>
			</AlertAction>
		</Alert>
	);
}
