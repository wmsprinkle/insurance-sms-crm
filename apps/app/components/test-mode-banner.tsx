"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

export function useDryRun(): boolean {
	const trpc = useTRPC();
	const summary = useQuery(trpc.today.summary.queryOptions());
	return summary.data?.dryRun ?? false;
}
