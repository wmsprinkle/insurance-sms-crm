const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MINUTES = 60;
export const DAY_MS = 24 * HOUR_MINUTES * MINUTE_MS;

export const CALENDAR_WRITE = {
	api: {
		baseUrl: "https://www.googleapis.com/calendar/v3",
		timeoutMs: 20 * SECOND_MS,
		primaryCalendarId: "primary",
		meetSolution: "hangoutsMeet",
	},
	backoff: {
		minMs: 30 * SECOND_MS,
		maxMs: 15 * MINUTE_MS,
	},
	businessHours: {
		weekdays: [1, 2, 3, 4, 5],
		startMinute: 9 * HOUR_MINUTES,
		endMinute: 17 * HOUR_MINUTES,
	},
	slots: {
		durationMinutes: 30,
		stepMinutes: 30,
		leadMinutes: 2 * HOUR_MINUTES,
		bufferMinutes: 0,
		horizonDays: 7,
		count: 3,
		minCount: 2,
		maxCount: 3,
	},
} as const;
