import { defineEval } from "eve/evals";
import { BOOKING_CASES, bookingMessage } from "./booking-cases";

function hasModel(): boolean {
	return Boolean(
		process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
	);
}

export default BOOKING_CASES.map((row) =>
	defineEval({
		description: `SMS booking: ${row.name}`,
		tags: ["sms", "booking"],
		async test(t) {
			if (!hasModel()) {
				t.skip("Requires an AI Gateway credential. It spends model credits.");
				return;
			}

			await t.send(bookingMessage(row));
			t.succeeded();
			t.calledTool(row.tool, row.input ? { input: row.input } : undefined);
			if (row.notTool) t.notCalledTool(row.notTool);
		},
	}),
);
