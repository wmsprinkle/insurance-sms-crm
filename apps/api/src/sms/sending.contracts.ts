import { z } from "zod";

export const sendingStateOutput = z.object({
	live: z.boolean(),
	canGoLive: z.boolean(),
	missing: z.array(z.string()),
});

export const setSendingInput = z.object({
	live: z.boolean(),
});
