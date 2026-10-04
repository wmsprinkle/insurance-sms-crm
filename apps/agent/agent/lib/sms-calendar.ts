import {
	CALENDAR_BOOK_PATH,
	type CalendarBridgeRequest,
	type CalendarBridgeResponse,
	calendarBridgeRequest,
	parseCalendarBridgeResponse,
} from "@crm/validation/calendar-book";
import { SMS_AGENT } from "./sms-config";

export type CalendarAttempt =
	| CalendarBridgeResponse
	| { status: "no-bridge"; reason: string };

export type CalendarPath = (
	request: CalendarBridgeRequest,
) => Promise<CalendarAttempt>;

type Env = Record<string, string | undefined>;

function reasonOf(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export function apiCalendarPath(
	env: Env = process.env,
	fetcher: typeof fetch = fetch,
): CalendarPath {
	return async (request) => {
		const secret = env.AGENT_BRIDGE_SECRET?.trim();
		const base = (env.API_INTERNAL_URL ?? env.API_URL)?.trim();
		if (!secret || !base) {
			return {
				status: "no-bridge",
				reason: "API_URL or AGENT_BRIDGE_SECRET is not set.",
			};
		}

		let response: Response;
		try {
			response = await fetcher(new URL(CALENDAR_BOOK_PATH, base), {
				method: "POST",
				headers: {
					authorization: `Bearer ${secret}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(calendarBridgeRequest.parse(request)),
				signal: AbortSignal.timeout(SMS_AGENT.booking.bridgeTimeoutMs),
			});
		} catch (cause) {
			return {
				status: "no-bridge",
				reason: `The API did not answer: ${reasonOf(cause)}`,
			};
		}

		if (!response.ok) {
			return {
				status: "no-bridge",
				reason: `The API answered ${response.status} on ${CALENDAR_BOOK_PATH}.`,
			};
		}

		return parseCalendarBridgeResponse(await response.json());
	};
}
