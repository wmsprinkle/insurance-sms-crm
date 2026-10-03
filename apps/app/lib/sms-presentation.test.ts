import { describe, expect, it } from "bun:test";
import {
	smsFailed,
	smsPreviewPrefix,
	smsStatus,
	smsThreadNotices,
} from "./sms-presentation";

describe("smsStatus", () => {
	it("marks failures as errors", () => {
		expect(smsStatus("SENDING_FAILED").tone).toBe("error");
		expect(smsFailed("DELIVERY_FAILED")).toBe(true);
		expect(smsFailed("DELIVERED")).toBe(false);
	});
});

describe("smsPreviewPrefix", () => {
	it("prefixes only outbound messages", () => {
		expect(smsPreviewPrefix("OUTBOUND")).toBe("You: ");
		expect(smsPreviewPrefix("INBOUND")).toBe("");
	});
});

describe("smsThreadNotices", () => {
	it("is empty for a textable contact", () => {
		expect(
			smsThreadNotices({
				phone: "+15555550100",
				suppressed: false,
				consented: true,
			}),
		).toEqual([]);
	});

	it("explains an opted-out contact without consent", () => {
		const titles = smsThreadNotices({
			phone: "+15555550100",
			suppressed: true,
			consented: false,
		}).map((notice) => notice.title);
		expect(titles).toEqual(["Opted out", "No consent on file"]);
	});
});
