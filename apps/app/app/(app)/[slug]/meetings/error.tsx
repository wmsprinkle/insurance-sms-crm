"use client";

import { PageError } from "@/components/page-error";

export default function MeetingsError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<PageError title="Could not load meetings" error={error} reset={reset} />
	);
}
