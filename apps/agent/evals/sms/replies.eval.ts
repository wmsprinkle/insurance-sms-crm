import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { caseMessage, PRICE_PATTERN, SMS_CASES } from "./cases";

function hasModel(): boolean {
	return Boolean(
		process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
	);
}

export default SMS_CASES.map((row) =>
	defineEval({
		description: `SMS reply: ${row.name}`,
		tags: ["sms", "classification"],
		async test(t) {
			if (!hasModel()) {
				t.skip("Requires an AI Gateway credential. It spends model credits.");
				return;
			}

			await t.send(caseMessage(row.inbound));
			t.succeeded();
			t.calledTool("classify_reply", {
				input: {
					label: (value: unknown) =>
						row.labels.some((label) => label === value),
				},
			});

			if (row.tool) {
				t.calledTool(row.tool.name, { input: row.tool.input });
			}
			if (row.silent) {
				t.notCalledTool("send_sms");
			}
			if (row.noQuote) {
				t.calledTool("send_sms", {
					input: {
						body: (value: unknown) =>
							typeof value === "string" && !PRICE_PATTERN.test(value),
					},
				}).soft();
				t.check(
					t.reply ?? "",
					satisfies<string>(
						(value) => !PRICE_PATTERN.test(value),
						"quotes no price",
					),
				);
			}
		},
	}),
);
