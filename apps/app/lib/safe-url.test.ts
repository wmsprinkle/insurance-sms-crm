import { describe, expect, it } from "bun:test";
import { safeHttpUrl } from "./safe-url";

describe("safeHttpUrl", () => {
	it("keeps http and https links", () => {
		expect(safeHttpUrl("https://meet.google.com/abc")).toBe(
			"https://meet.google.com/abc",
		);
		expect(safeHttpUrl("http://example.com")).toBe("http://example.com/");
	});

	it("rejects script, data and other schemes", () => {
		for (const value of [
			"javascript:alert(1)",
			" JaVaScRiPt:alert(1)",
			"data:text/html,<script>1</script>",
			"vbscript:x",
			"file:///etc/passwd",
			"//evil.com",
			"not a url",
			"",
			null,
			undefined,
		]) {
			expect(safeHttpUrl(value)).toBeNull();
		}
	});
});
