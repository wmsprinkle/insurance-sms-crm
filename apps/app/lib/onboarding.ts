import type { NextRequest } from "next/server";
import { z } from "zod";
import { API_URL } from "@/lib/env";

export const ONBOARDING_PATH = "/onboarding";

const GATE_TIMEOUT_MS = 2_000;

const procedureResult = z
	.object({ result: z.object({ data: z.json() }).catch({ data: null }) })
	.catch({ result: { data: null } });

const workspaceAnswer = z
	.object({ slug: z.string().min(1).nullable().catch(null) })
	.catch({ slug: null });

async function read(request: NextRequest, procedure: string) {
	const cookie = request.headers.get("cookie");

	if (!cookie) return null;

	try {
		const response = await fetch(`${API_URL}/api/trpc/${procedure}`, {
			headers: { cookie },
			cache: "no-store",
			signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
		});

		if (!response.ok) return null;

		return procedureResult.parse(await response.json()).result.data;
	} catch {
		return null;
	}
}

export async function readWorkspaceSlug(
	request: NextRequest,
): Promise<string | null> {
	return workspaceAnswer.parse(await read(request, "workspace.get")).slug;
}
