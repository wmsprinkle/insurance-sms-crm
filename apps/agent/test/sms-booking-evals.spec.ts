import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { BOOKING_CASES, bookingMessage } from "../evals/sms/booking-cases";

function skill(name: string): string {
	return readFileSync(
		new URL(`../agent/skills/${name}.md`, import.meta.url),
		"utf8",
	);
}

describe("booking eval cases", () => {
	it("cover proposing, picking, giving an email and refusing one", () => {
		expect(BOOKING_CASES.map((row) => row.tool)).toEqual([
			"propose_slots",
			"book_meeting",
			"book_meeting",
			"book_meeting",
		]);
	});

	it("name tools the agent ships", () => {
		for (const row of BOOKING_CASES) {
			expect(
				existsSync(new URL(`../agent/tools/${row.tool}.ts`, import.meta.url)),
			).toBe(true);
		}
	});

	it("fence the lead's words and carry the thread", () => {
		for (const row of BOOKING_CASES) {
			const message = bookingMessage(row);
			expect(message).toContain(`<<<\n${row.inbound}\n>>>`);
			expect(message).toContain("Booking link: none");
			expect(message).toContain(`Us: ${row.history[0]?.[1]}`);
		}
	});

	it("are backed by the booking steps in the qualification skill", () => {
		const text = skill("qualification");
		expect(text).toContain("## Booking the call");
		for (const word of [
			"propose_slots",
			"book_meeting",
			"needs-email",
			"emailDeclined",
			"slot-taken",
		]) {
			expect(text).toContain(word);
		}
	});
});
