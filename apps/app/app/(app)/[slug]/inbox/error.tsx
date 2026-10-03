"use client";

import { PageError } from "@/components/page-error";

export default function RouteError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return <PageError title="Something went wrong" error={error} reset={reset} />;
}
