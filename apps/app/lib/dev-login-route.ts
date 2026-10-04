import {
	DEV_LOGIN_APP_PATH,
	isLoopbackAppRequest,
	isLoopbackUrl,
} from "@crm/auth/dev-login";
import {
	createDevLoginProof,
	DEV_LOGIN_PROOF_HEADER,
} from "@crm/auth/dev-login-proof";

export type DevLoginRouteDeps = {
	apiUrl: string;
	secret: string | undefined;
	fetch: typeof fetch;
};

const REFUSED = "Dev sign-in answers only on localhost.";

function refuse(status: number, message: string): Response {
	return Response.json({ message }, { status });
}

export async function handleDevLogin(
	request: Request,
	deps: DevLoginRouteDeps,
): Promise<Response> {
	const origin = request.headers.get("origin");

	if (
		!isLoopbackAppRequest(request.headers) ||
		(origin !== null && !isLoopbackUrl(origin))
	) {
		return refuse(403, REFUSED);
	}

	if (!deps.secret) {
		return refuse(403, "Dev sign-in needs AGENT_BRIDGE_SECRET.");
	}

	let upstream: Response;

	try {
		upstream = await deps.fetch(`${deps.apiUrl}${DEV_LOGIN_APP_PATH}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				[DEV_LOGIN_PROOF_HEADER]: createDevLoginProof(deps.secret),
			},
			body: "{}",
			redirect: "manual",
		});
	} catch {
		return refuse(502, `The API at ${deps.apiUrl} is not reachable.`);
	}

	const headers = new Headers({ "content-type": "application/json" });
	for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
		headers.append("set-cookie", cookie);
	}

	return new Response(await upstream.text(), {
		status: upstream.status,
		headers,
	});
}
