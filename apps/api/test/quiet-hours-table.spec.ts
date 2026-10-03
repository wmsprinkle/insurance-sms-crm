import { describe, expect, it } from "bun:test";
import {
	describeWindow,
	quietHoursTable,
} from "../src/settings/quiet-hours-table";

describe("quietHoursTable", () => {
	const rows = quietHoursTable();

	it("starts with the federal 08:00–21:00 window on every day", () => {
		expect(rows[0]?.scope).toBe("Federal");
		expect(rows[0]?.days.map((day) => day.window)).toEqual(
			Array(7).fill("08:00–21:00"),
		);
	});

	it("lists stricter states in alphabetical order", () => {
		const states = rows.slice(1).map((row) => row.scope);
		expect(states).toEqual([...states].sort());
		expect(states).toContain("FL");
	});

	it("shows a closed day as null", () => {
		const alabama = rows.find((row) => row.scope === "AL");
		expect(alabama?.days[0]).toEqual({ day: "Sun", window: null });
		expect(alabama?.days[1]).toEqual({ day: "Mon", window: "08:00–20:00" });
	});
});

describe("describeWindow", () => {
	it("pads minutes", () => {
		expect(describeWindow({ from: 9 * 60 + 5, to: 17 * 60 })).toBe(
			"09:05–17:00",
		);
	});
});
