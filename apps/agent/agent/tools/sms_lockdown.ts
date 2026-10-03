import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { SMS_AGENT } from "../lib/sms-config";
import { lockedToolCall, smsLockdownApplies } from "../lib/sms-tools";

function lockdown(ctx: Parameters<typeof smsLockdownApplies>[0]) {
	if (!smsLockdownApplies(ctx)) return null;
	return Object.fromEntries(
		SMS_AGENT.tools.locked.map((name) => [
			name,
			defineTool({
				description: SMS_AGENT.tools.lockedDescription,
				inputSchema: z.looseObject({}),
				execute: () => lockedToolCall(name),
			}),
		]),
	);
}

export default defineDynamic({
	events: {
		"session.started": (_event, ctx) => lockdown(ctx),
		"turn.started": (_event, ctx) => lockdown(ctx),
	},
});
