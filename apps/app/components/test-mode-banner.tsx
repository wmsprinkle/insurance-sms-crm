"use client";

import Warning from "@carbon/icons-react/es/Warning";
import { Icon } from "@crm/ui/components/icon";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

export const TEST_MODE_MESSAGE = "Test mode: no texts are really sent";

export function useDryRun(): boolean {
	const trpc = useTRPC();
	const summary = useQuery(trpc.today.summary.queryOptions());
	return summary.data?.dryRun ?? false;
}

export function TestModeBanner() {
	if (!useDryRun()) return null;

	return (
		<div
			role="status"
			className="flex shrink-0 items-center justify-center gap-2 border-b bg-warning/15 px-3 py-1.5 text-center font-medium text-sm"
		>
			<Icon icon={Warning} aria-hidden />
			<span>{TEST_MODE_MESSAGE}</span>
		</div>
	);
}
