import { SMS_ENV } from "@crm/env/sms";
import {
	parseSmsSendResponse,
	SMS_SEND_PATH,
	type SmsSendRequest,
	type SmsSendResponse,
	smsSendRequest,
} from "@crm/validation/sms-send";
import { SMS_AGENT } from "./sms-config";

export type SendAttempt =
	| SmsSendResponse
	| { status: "unavailable"; reason: string }
	| { status: "unknown"; reason: string };

export type SendPath = (request: SmsSendRequest) => Promise<SendAttempt>;

type Env = Record<string, string | undefined>;

export function dryRunFrom(env: Env = process.env): boolean {
	return env[SMS_ENV.dryRun]?.trim() !== "false";
}

function reasonOf(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function isTimeout(cause: unknown): boolean {
	return (
		cause instanceof Error &&
		(cause.name === "TimeoutError" || cause.name === "AbortError")
	);
}

export function apiSendPath(
	env: Env = process.env,
	fetcher: typeof fetch = fetch,
): SendPath {
	return async (request) => {
		const secret = env.AGENT_BRIDGE_SECRET?.trim();
		const base = (env.API_INTERNAL_URL ?? env.API_URL)?.trim();
		if (!secret || !base) {
			return {
				status: "unavailable",
				reason: "API_URL or AGENT_BRIDGE_SECRET is not set.",
			};
		}

		let response: Response;
		try {
			response = await fetcher(new URL(SMS_SEND_PATH, base), {
				method: "POST",
				headers: {
					authorization: `Bearer ${secret}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(smsSendRequest.parse(request)),
				signal: AbortSignal.timeout(SMS_AGENT.bridge.timeoutMs),
			});
		} catch (cause) {
			if (isTimeout(cause)) {
				return {
					status: "unknown",
					reason: `The API did not answer within ${SMS_AGENT.bridge.timeoutMs / 1000} s. It may still send the text under the same key.`,
				};
			}
			return {
				status: "unavailable",
				reason: `The API did not answer: ${reasonOf(cause)}`,
			};
		}

		if (!response.ok) {
			return {
				status: "unavailable",
				reason: `The API answered ${response.status} on ${SMS_SEND_PATH}.`,
			};
		}

		return parseSmsSendResponse(await response.json());
	};
}
