import type { UsState } from "./us-states";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export type DayWindow = { from: number; to: number } | null;

export type WeekWindow = readonly [
	DayWindow,
	DayWindow,
	DayWindow,
	DayWindow,
	DayWindow,
	DayWindow,
	DayWindow,
];

const hours = (from: number, to: number): DayWindow => ({
	from: from * 60,
	to: to * 60,
});

const everyDay = (from: number, to: number): WeekWindow => {
	const day = hours(from, to);
	return [day, day, day, day, day, day, day];
};

const closedSunday = (from: number, to: number): WeekWindow => {
	const day = hours(from, to);
	return [null, day, day, day, day, day, day];
};

const EASTERN = ["America/New_York"] as const;
const CENTRAL = ["America/Chicago"] as const;
const MOUNTAIN = ["America/Denver"] as const;
const PACIFIC = ["America/Los_Angeles"] as const;

export const COMPLIANCE = {
	quietHours: {
		federal: everyDay(8, 21),
		byState: {
			AL: closedSunday(8, 20),
			CT: everyDay(9, 20),
			FL: everyDay(8, 20),
			LA: closedSunday(8, 20),
			MA: everyDay(8, 20),
			MD: everyDay(8, 20),
			MS: closedSunday(8, 20),
			OK: everyDay(8, 20),
			RI: [
				null,
				hours(9, 18),
				hours(9, 18),
				hours(9, 18),
				hours(9, 18),
				hours(9, 18),
				hours(10, 17),
			],
			TX: [
				hours(12, 21),
				hours(9, 21),
				hours(9, 21),
				hours(9, 21),
				hours(9, 21),
				hours(9, 21),
				hours(9, 21),
			],
			WA: everyDay(8, 20),
		} satisfies Partial<Record<UsState, WeekWindow>>,
		searchStepMs: 15 * MINUTE_MS,
		searchHorizonMs: 8 * DAY_MS,
	},
	timezones: {
		byState: {
			AL: CENTRAL,
			AK: ["America/Anchorage", "America/Adak"],
			AZ: ["America/Phoenix"],
			AR: CENTRAL,
			CA: PACIFIC,
			CO: MOUNTAIN,
			CT: EASTERN,
			DE: EASTERN,
			DC: EASTERN,
			FL: ["America/New_York", "America/Chicago"],
			GA: EASTERN,
			HI: ["Pacific/Honolulu"],
			ID: ["America/Boise", "America/Los_Angeles"],
			IL: CENTRAL,
			IN: ["America/Indiana/Indianapolis", "America/Chicago"],
			IA: CENTRAL,
			KS: ["America/Chicago", "America/Denver"],
			KY: ["America/New_York", "America/Chicago"],
			LA: CENTRAL,
			ME: EASTERN,
			MD: EASTERN,
			MA: EASTERN,
			MI: ["America/Detroit", "America/Menominee"],
			MN: CENTRAL,
			MS: CENTRAL,
			MO: CENTRAL,
			MT: MOUNTAIN,
			NE: ["America/Chicago", "America/Denver"],
			NV: PACIFIC,
			NH: EASTERN,
			NJ: EASTERN,
			NM: MOUNTAIN,
			NY: EASTERN,
			NC: EASTERN,
			ND: ["America/Chicago", "America/Denver"],
			OH: EASTERN,
			OK: CENTRAL,
			OR: ["America/Los_Angeles", "America/Boise"],
			PA: EASTERN,
			RI: EASTERN,
			SC: EASTERN,
			SD: ["America/Chicago", "America/Denver"],
			TN: ["America/Chicago", "America/New_York"],
			TX: ["America/Chicago", "America/Denver"],
			UT: MOUNTAIN,
			VT: EASTERN,
			VA: EASTERN,
			WA: PACIFIC,
			WV: EASTERN,
			WI: CENTRAL,
			WY: MOUNTAIN,
		} satisfies Record<UsState, readonly string[]>,
		unknown: [
			"America/New_York",
			"America/Chicago",
			"America/Denver",
			"America/Phoenix",
			"America/Los_Angeles",
			"America/Anchorage",
			"America/Adak",
			"Pacific/Honolulu",
		],
	},
	audit: {
		sessionId: "compliance:send-gate",
		allowed: "sms.send.allowed",
		blocked: "sms.send.blocked",
	},
	frequency: {
		day: { windowMs: DAY_MS, max: 3 },
		week: { windowMs: 7 * DAY_MS, max: 7 },
	},
	optOutConfirmation: {
		windowMs: 5 * MINUTE_MS,
		claimSessionId: "compliance:opt-out-confirmation",
		claimType: "sms.opt-out.confirmed",
		claimPrefix: "opt-out:",
	},
	supportedCountryPrefix: "+1",
	retention: {
		keptEventSessions: ["compliance:send-gate", "sms:send", "sms:keyword"],
		years: 5,
		note: "Kept after the contact was purged: TCPA consent and send-decision proof.",
	},
	adminAudit: {
		sessionId: "compliance:admin",
		smsSettingsChanged: "settings.sms.changed",
		leadsImported: "leads.import.committed",
	},
} as const;
