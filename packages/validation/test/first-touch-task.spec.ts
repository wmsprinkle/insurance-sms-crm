import { describe, expect, it } from "bun:test";
import {
	FIRST_TOUCH_TASK_KIND,
	parseFirstTouchTaskPayload,
} from "../src/first-touch-task";

const payload = {
	type: "lead.created",
	to: "+15125550123",
	message: "Hi Ana, this is Acme Insurance. Reply STOP to opt out.",
	origin: "LEAD_IMPORT",
};

describe("parseFirstTouchTaskPayload", () => {
	it("reads a stored payload", () => {
		expect(parseFirstTouchTaskPayload(payload)).toEqual(payload);
		expect(FIRST_TOUCH_TASK_KIND).toBe("first-touch");
	});

	it("rejects a recipient that is not E.164", () => {
		expect(() =>
			parseFirstTouchTaskPayload({ ...payload, to: "512-555-0123" }),
		).toThrow(/to Not an E.164 number/);
	});

	it("rejects an empty message and a missing type", () => {
		expect(() =>
			parseFirstTouchTaskPayload({ ...payload, message: "  " }),
		).toThrow(/message/);
		expect(() =>
			parseFirstTouchTaskPayload({ ...payload, type: "sms.received" }),
		).toThrow(/type/);
	});
});
