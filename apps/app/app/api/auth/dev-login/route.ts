import { connection } from "next/server";
import { handleDevLogin } from "@/lib/dev-login-route";
import { API_SERVER_URL } from "@/lib/env";

export async function POST(request: Request): Promise<Response> {
	await connection();

	return handleDevLogin(request, {
		apiUrl: API_SERVER_URL,
		secret: process.env.AGENT_BRIDGE_SECRET?.trim(),
		fetch,
	});
}
