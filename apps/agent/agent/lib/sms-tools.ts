import { purposeOf } from "./session-purpose";
import { SMS_AGENT } from "./sms-config";

export function smsLockdownApplies(
	ctx: Parameters<typeof purposeOf>[0],
): boolean {
	return purposeOf(ctx) === "sms";
}

export function lockedToolCall(name: string) {
	console.error(`[sms] Refused locked tool ${name} in an SMS conversation`);
	return { ok: false as const, reason: SMS_AGENT.tools.lockedReason };
}
