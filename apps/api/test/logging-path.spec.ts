import { describe, expect, it } from "bun:test";
import { loggablePath } from "../src/logging/loggable-path";

describe("loggablePath", () => {
	it("drops the query string with share tokens and tRPC inputs", () => {
		expect(loggablePath("/api/attachments/1?share=secret&x=1")).toBe(
			"/api/attachments/1",
		);
		expect(loggablePath('/trpc/leads.get?input={"phone":"+15551234567"}')).toBe(
			"/trpc/leads.get",
		);
	});

	it("keeps a path with no query", () => {
		expect(loggablePath("/health")).toBe("/health");
	});
});
