import { z } from "zod";
import { e164 } from "./phone";

export const FIRST_TOUCH_TASK_KIND = "first-touch";

export const firstTouchTaskPayload = z.object({
	type: z.literal("lead.created"),
	to: e164,
	message: z.string().trim().min(1),
	origin: z.string().trim().min(1),
});

export type FirstTouchTaskPayload = z.infer<typeof firstTouchTaskPayload>;

export function parseFirstTouchTaskPayload(
	value: unknown,
): FirstTouchTaskPayload {
	const parsed = firstTouchTaskPayload.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`Unreadable first-touch task payload: ${parsed.error.issues
				.map((issue) => `${issue.path.join(".") || "payload"} ${issue.message}`)
				.join("; ")}`,
		);
	}
	return parsed.data;
}
