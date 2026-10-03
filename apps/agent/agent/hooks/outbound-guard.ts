import {
	breaksCharacter,
	OUTBOUND_GUARD as SHARED_GUARD,
} from "@crm/validation/outbound-guard";
import { defineHook } from "eve/hooks";
import { z } from "zod";

export const OUTBOUND_GUARD = {
	...SHARED_GUARD,
	historyMessages: 16,
	historyMessageChars: 400,
	sendToolName: "send_sms",
} as const;

export const outboundSmsInput = z.object({ body: z.string() });

export function attemptedViolations(body: string): string[] {
	const violations: string[] = [];
	if (breaksCharacter(body, "disclose")) violations.push("breaks_character");
	if (Array.from(body).length > OUTBOUND_GUARD.maxChars) {
		violations.push("over_length");
	}
	return violations;
}

export default defineHook({
	events: {
		"actions.requested"(event) {
			for (const action of event.data.actions) {
				if (action.kind !== "tool-call") continue;
				if (action.toolName !== OUTBOUND_GUARD.sendToolName) continue;

				const parsed = outboundSmsInput.safeParse(action.input);

				if (!parsed.success) {
					console.error(
						`[outbound-guard] ${action.toolName} input unreadable: ${parsed.error.message}`,
					);
					continue;
				}

				const violations = attemptedViolations(parsed.data.body);

				if (violations.length > 0) {
					console.error(
						`[outbound-guard] ${action.toolName} ${action.callId} attempted ${violations.join(", ")}`,
					);
				}
			}
		},
	},
});
