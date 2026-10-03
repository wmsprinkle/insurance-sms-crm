"use client";

import { Button } from "@crm/ui/components/button";
import Link from "next/link";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

export function SmsNavLink({ path, label }: { path: string; label: string }) {
	const workspaceUrl = useWorkspaceUrl();

	return (
		<Button asChild variant="outline" size="sm">
			<Link href={workspaceUrl(path)}>{label}</Link>
		</Button>
	);
}
