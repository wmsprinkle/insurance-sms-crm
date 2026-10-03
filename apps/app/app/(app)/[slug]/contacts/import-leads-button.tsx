"use client";

import Upload from "@carbon/icons-react/es/Upload";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import Link from "next/link";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

export function ImportLeadsButton() {
	const workspaceUrl = useWorkspaceUrl();

	return (
		<Button asChild variant="outline">
			<Link href={workspaceUrl("/leads/import")}>
				<Icon icon={Upload} data-icon="inline-start" />
				Import leads
			</Link>
		</Button>
	);
}
