import { describe, expect, it } from "bun:test";
import { AREA_CODES_BY_STATE } from "../src/compliance/area-codes";
import {
	isWithinSendWindow,
	localClock,
	nextSendWindow,
	sendWindowFor,
	stateForPhone,
} from "../src/compliance/quiet-hours";
import { US_STATES } from "../src/compliance/us-states";

const at = (iso: string) => new Date(iso);

describe("stateForPhone", () => {
	it("maps a US area code to its state", () => {
		expect(stateForPhone("+13055550123")).toBe("FL");
		expect(stateForPhone("+15125550123")).toBe("TX");
		expect(stateForPhone("+12125550123")).toBe("NY");
	});

	it("returns null for toll-free, Canadian and non-NANP numbers", () => {
		expect(stateForPhone("+18005550100")).toBeNull();
		expect(stateForPhone("+14165550123")).toBeNull();
		expect(stateForPhone("+442071234567")).toBeNull();
	});

	it("lists every state and no area code twice", () => {
		const codes = US_STATES.flatMap((state) => AREA_CODES_BY_STATE[state]);
		expect(new Set(codes).size).toBe(codes.length);
		for (const state of US_STATES) {
			expect(AREA_CODES_BY_STATE[state].length).toBeGreaterThan(0);
		}
	});
});

describe("localClock", () => {
	it("reads weekday and minutes in the recipient's zone, with DST", () => {
		expect(localClock(at("2026-10-05T13:30:00Z"), "America/New_York")).toEqual({
			weekday: 1,
			minutes: 9 * 60 + 30,
		});
		expect(localClock(at("2026-12-07T13:30:00Z"), "America/New_York")).toEqual({
			weekday: 1,
			minutes: 8 * 60 + 30,
		});
	});
});

describe("sendWindowFor", () => {
	it("prefers a declared state over the area code", () => {
		expect(sendWindowFor({ e164: "+12125550123", state: "fl" }).state).toBe(
			"FL",
		);
		expect(sendWindowFor({ e164: "+12125550123", state: "ZZ" }).state).toBe(
			"NY",
		);
	});

	it("uses every US zone and every state rule when the state is unknown", () => {
		const window = sendWindowFor({ e164: "+18005550100" });
		expect(window.state).toBeNull();
		expect(window.timezones).toContain("Pacific/Honolulu");
		expect(window.rules.length).toBe(US_STATES.length + 1);
	});
});

describe("isWithinSendWindow", () => {
	const ny = sendWindowFor({ e164: "+12125550123" });
	const fl = sendWindowFor({ e164: "+13055550123" });

	it("applies the federal 8am-9pm window", () => {
		expect(isWithinSendWindow(at("2026-10-05T11:59:00Z"), ny)).toBe(false);
		expect(isWithinSendWindow(at("2026-10-05T12:00:00Z"), ny)).toBe(true);
		expect(isWithinSendWindow(at("2026-10-06T00:59:00Z"), ny)).toBe(true);
		expect(isWithinSendWindow(at("2026-10-06T01:00:00Z"), ny)).toBe(false);
	});

	it("applies a stricter state window", () => {
		expect(isWithinSendWindow(at("2026-10-06T00:30:00Z"), fl)).toBe(false);
	});

	it("requires every zone of a split state to be inside the window", () => {
		expect(isWithinSendWindow(at("2026-10-05T12:30:00Z"), fl)).toBe(false);
		expect(isWithinSendWindow(at("2026-10-05T13:00:00Z"), fl)).toBe(true);
	});

	it("honours day rules such as Texas Sunday noon", () => {
		const tx = sendWindowFor({ e164: "+15125550123" });
		expect(isWithinSendWindow(at("2026-10-04T16:00:00Z"), tx)).toBe(false);
		expect(isWithinSendWindow(at("2026-10-04T18:00:00Z"), tx)).toBe(true);
	});

	it("blocks Sunday where a state closes it", () => {
		const al = sendWindowFor({ e164: "+12055550123" });
		expect(isWithinSendWindow(at("2026-10-04T18:00:00Z"), al)).toBe(false);
	});
});

describe("nextSendWindow", () => {
	it("returns now when already inside the window", () => {
		const now = at("2026-10-05T15:00:00Z");
		const ny = sendWindowFor({ e164: "+12125550123" });
		expect(nextSendWindow(now, ny)).toBe(now);
	});

	it("finds the next morning after a late-night attempt", () => {
		const ny = sendWindowFor({ e164: "+12125550123" });
		expect(nextSendWindow(at("2026-10-06T02:07:00Z"), ny)).toEqual(
			at("2026-10-06T12:00:00Z"),
		);
	});

	it("still finds a window for a number with no known state", () => {
		const unknown = sendWindowFor({ e164: "+18005550100" });
		const next = nextSendWindow(at("2026-10-04T12:00:00Z"), unknown);
		expect(next).not.toBeNull();
		if (next) expect(isWithinSendWindow(next, unknown)).toBe(true);
	});
});
