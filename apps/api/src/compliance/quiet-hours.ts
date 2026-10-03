import { AREA_CODES_BY_STATE } from "./area-codes";
import { COMPLIANCE, type WeekWindow } from "./compliance-config";
import { isUsState, US_STATES, type UsState } from "./us-states";

export type Recipient = {
	e164: string;
	state?: string | null;
};

export type SendWindow = {
	state: UsState | null;
	timezones: readonly string[];
	rules: readonly WeekWindow[];
};

const STATE_BY_AREA_CODE = new Map<string, UsState>(
	US_STATES.flatMap((state) =>
		AREA_CODES_BY_STATE[state].map((code): [string, UsState] => [code, state]),
	),
);

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
	let existing = formatters.get(timeZone);
	if (!existing) {
		existing = new Intl.DateTimeFormat("en-US", {
			timeZone,
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});
		formatters.set(timeZone, existing);
	}
	return existing;
}

export type LocalClock = { weekday: number; minutes: number };

export function localClock(at: Date, timeZone: string): LocalClock {
	const parts = formatter(timeZone).formatToParts(at);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((entry) => entry.type === type)?.value ?? "";

	return {
		weekday: WEEKDAYS.indexOf(part("weekday")),
		minutes: Number(part("hour")) * 60 + Number(part("minute")),
	};
}

export function stateForPhone(e164: string): UsState | null {
	if (!e164.startsWith("+1") || e164.length !== 12) return null;
	return STATE_BY_AREA_CODE.get(e164.slice(2, 5)) ?? null;
}

function ruleFor(state: UsState): WeekWindow {
	const overrides: Partial<Record<UsState, WeekWindow>> =
		COMPLIANCE.quietHours.byState;
	return overrides[state] ?? COMPLIANCE.quietHours.federal;
}

export function sendWindowFor(recipient: Recipient): SendWindow {
	const declared = recipient.state?.trim().toUpperCase() ?? "";
	const states = [
		...new Set(
			[
				isUsState(declared) ? declared : null,
				stateForPhone(recipient.e164),
			].filter((state): state is UsState => state !== null),
		),
	];
	const [state] = states;

	if (state) {
		return {
			state,
			timezones: [
				...new Set(
					states.flatMap((entry) => COMPLIANCE.timezones.byState[entry]),
				),
			],
			rules: [...new Set(states.map(ruleFor))],
		};
	}

	return {
		state: null,
		timezones: COMPLIANCE.timezones.unknown,
		rules: [COMPLIANCE.quietHours.federal, ...US_STATES.map(ruleFor)],
	};
}

export function isWithinSendWindow(at: Date, window: SendWindow): boolean {
	return window.timezones.every((timeZone) => {
		const { weekday, minutes } = localClock(at, timeZone);
		return window.rules.every((rule) => {
			const day = rule[weekday];
			return (
				day !== null &&
				day !== undefined &&
				minutes >= day.from &&
				minutes < day.to
			);
		});
	});
}

export function nextSendWindow(at: Date, window: SendWindow): Date | null {
	if (isWithinSendWindow(at, window)) return at;

	const { searchStepMs, searchHorizonMs } = COMPLIANCE.quietHours;
	const start = Math.ceil(at.getTime() / searchStepMs) * searchStepMs;

	for (
		let candidate = start;
		candidate <= at.getTime() + searchHorizonMs;
		candidate += searchStepMs
	) {
		const when = new Date(candidate);
		if (isWithinSendWindow(when, window)) return when;
	}

	return null;
}
