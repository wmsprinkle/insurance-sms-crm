"use client";

import { authClient } from "@crm/auth/client";
import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import { Spinner } from "@crm/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";

export function DevSignIn({
	email,
	primary,
}: {
	email: string;
	primary: boolean;
}) {
	const [pending, setPending] = useState(false);

	function fail(message?: string) {
		setPending(false);
		toast.error(message ?? "Could not reach the sign-in service.");
	}

	async function handleClick() {
		setPending(true);

		const { error } = await authClient.$fetch("/dev-login", {
			method: "POST",
		});

		if (error) {
			fail(error.message);
			return;
		}

		window.location.assign("/");
	}

	return (
		<div className="flex flex-col items-center gap-2">
			<Button
				className="w-full"
				disabled={pending}
				onClick={() => {
					handleClick().catch(() => fail());
				}}
				type="button"
				variant={primary ? "default" : "outline"}
			>
				{pending ? <Spinner data-icon="inline-start" /> : null}
				Continue as {email}
			</Button>
			<Badge variant="secondary">Local development only</Badge>
		</div>
	);
}
