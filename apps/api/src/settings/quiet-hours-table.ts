import {
	COMPLIANCE,
	type DayWindow,
	type WeekWindow,
} from "../compliance/compliance-config";

const WEEKDAY_LABELS = [
	"Sun",
	"Mon",
	"Tue",
	"Wed",
	"Thu",
	"Fri",
	"Sat",
] as const;

type QuietHoursDay = { day: string; window: string | null };

export type QuietHoursRow = {
	scope: string;
	days: QuietHoursDay[];
};

function clock(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function describeWindow(window: DayWindow): string | null {
	return window ? `${clock(window.from)}–${clock(window.to)}` : null;
}

function rowOf(scope: string, week: WeekWindow): QuietHoursRow {
	return {
		scope,
		days: week.map((window, index) => ({
			day: WEEKDAY_LABELS[index] ?? String(index),
			window: describeWindow(window),
		})),
	};
}

export function quietHoursTable(): QuietHoursRow[] {
	const states = Object.entries(COMPLIANCE.quietHours.byState)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([state, week]) => rowOf(state, week));
	return [rowOf("Federal", COMPLIANCE.quietHours.federal), ...states];
}
