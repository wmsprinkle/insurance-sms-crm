import { CALENDAR_WRITE, DAY_MS, MINUTE_MS } from "./calendar-write.config";

export type Interval = { start: Date; end: Date };

type BusinessHours = {
	weekdays: readonly number[];
	startMinute: number;
	endMinute: number;
};

export type SlotOptions = {
	now: Date;
	timeZone: string;
	busy: readonly Interval[];
	businessHours?: BusinessHours;
	durationMinutes?: number;
	stepMinutes?: number;
	leadMinutes?: number;
	bufferMinutes?: number;
	horizonDays?: number;
	count?: number;
};

export type Slot = Interval & { timeZone: string };

type LocalParts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
	const cached = formatters.get(timeZone);
	if (cached) return cached;

	const created = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	formatters.set(timeZone, created);
	return created;
}

export function isTimeZone(timeZone: string): boolean {
	try {
		formatter(timeZone);
		return true;
	} catch {
		return false;
	}
}

function zonedParts(at: Date, timeZone: string): LocalParts {
	const parts = new Map(
		formatter(timeZone)
			.formatToParts(at)
			.map((part) => [part.type, Number(part.value)]),
	);

	return {
		year: parts.get("year") ?? 0,
		month: parts.get("month") ?? 0,
		day: parts.get("day") ?? 0,
		hour: parts.get("hour") ?? 0,
		minute: parts.get("minute") ?? 0,
		second: parts.get("second") ?? 0,
	};
}

function wallClockMs(parts: LocalParts): number {
	return Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
	);
}

function offsetMs(at: Date, timeZone: string): number {
	const wholeSeconds = Math.floor(at.getTime() / 1000) * 1000;
	return wallClockMs(zonedParts(at, timeZone)) - wholeSeconds;
}

export function zonedTimeToUtc(
	date: { year: number; month: number; day: number },
	minuteOfDay: number,
	timeZone: string,
): Date | null {
	const wall = Date.UTC(date.year, date.month - 1, date.day, 0, minuteOfDay);
	const first = wall - offsetMs(new Date(wall), timeZone);
	const settled = wall - offsetMs(new Date(first), timeZone);
	const at = new Date(settled);

	return wallClockMs(zonedParts(at, timeZone)) === wall ? at : null;
}

export function overlaps(a: Interval, b: Interval): boolean {
	return (
		a.start.getTime() < b.end.getTime() && a.end.getTime() > b.start.getTime()
	);
}

export function slotSearchWindow(
	options: Pick<SlotOptions, "now" | "horizonDays">,
): Interval {
	const horizonDays = options.horizonDays ?? CALENDAR_WRITE.slots.horizonDays;
	return {
		start: options.now,
		end: new Date(options.now.getTime() + (horizonDays + 1) * DAY_MS),
	};
}

export function candidateSlots(options: SlotOptions): Slot[] {
	if (!isTimeZone(options.timeZone)) {
		throw new RangeError(`Unknown time zone: ${options.timeZone}`);
	}

	const hours: BusinessHours =
		options.businessHours ?? CALENDAR_WRITE.businessHours;
	const defaults = CALENDAR_WRITE.slots;
	const durationMs =
		(options.durationMinutes ?? defaults.durationMinutes) * MINUTE_MS;
	const stepMinutes = options.stepMinutes ?? defaults.stepMinutes;
	const bufferMs =
		(options.bufferMinutes ?? defaults.bufferMinutes) * MINUTE_MS;
	const earliest =
		options.now.getTime() +
		(options.leadMinutes ?? defaults.leadMinutes) * MINUTE_MS;
	const horizonDays = options.horizonDays ?? defaults.horizonDays;

	if (durationMs <= 0 || stepMinutes <= 0) return [];

	const busy = options.busy.map((interval) => ({
		start: new Date(interval.start.getTime() - bufferMs),
		end: new Date(interval.end.getTime() + bufferMs),
	}));

	const today = zonedParts(options.now, options.timeZone);
	const slots: Slot[] = [];

	for (let offset = 0; offset <= horizonDays; offset += 1) {
		const calendarDay = new Date(
			Date.UTC(today.year, today.month - 1, today.day + offset),
		);
		if (!hours.weekdays.includes(calendarDay.getUTCDay())) continue;

		const date = {
			year: calendarDay.getUTCFullYear(),
			month: calendarDay.getUTCMonth() + 1,
			day: calendarDay.getUTCDate(),
		};

		for (
			let minute = hours.startMinute;
			minute * MINUTE_MS + durationMs <= hours.endMinute * MINUTE_MS;
			minute += stepMinutes
		) {
			const start = zonedTimeToUtc(date, minute, options.timeZone);
			if (!start || start.getTime() < earliest) continue;

			const slot = {
				start,
				end: new Date(start.getTime() + durationMs),
				timeZone: options.timeZone,
			};
			if (busy.some((interval) => overlaps(slot, interval))) continue;

			slots.push(slot);
		}
	}

	return slots;
}

export function generateSlots(options: SlotOptions): Slot[] {
	const defaults = CALENDAR_WRITE.slots;
	const count = Math.min(
		defaults.maxCount,
		Math.max(defaults.minCount, options.count ?? defaults.count),
	);
	const candidates = candidateSlots(options);

	const dayOf = (slot: Slot) => {
		const parts = zonedParts(slot.start, slot.timeZone);
		return `${parts.year}-${parts.month}-${parts.day}`;
	};

	const chosen: Slot[] = [];
	const days = new Set<string>();

	for (const slot of candidates) {
		if (chosen.length === count) break;
		const day = dayOf(slot);
		if (days.has(day)) continue;
		days.add(day);
		chosen.push(slot);
	}

	for (const slot of candidates) {
		if (chosen.length === count) break;
		if (!chosen.includes(slot)) chosen.push(slot);
	}

	return chosen.sort((a, b) => a.start.getTime() - b.start.getTime());
}
