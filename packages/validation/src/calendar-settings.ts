import { z } from "zod";

export const CALENDAR_SETTING_KEYS = {
	ownerUserId: "calendar.ownerUserId",
	fallbackBookingLink: "calendar.fallbackBookingLink",
} as const;

export const calendarSettings = z.object({
	ownerUserId: z.string().trim().min(1).nullable(),
	fallbackBookingLink: z
		.url({ protocol: /^https?$/ })
		.max(500)
		.nullable(),
});

export type CalendarSettings = z.infer<typeof calendarSettings>;

export const DEFAULT_CALENDAR_SETTINGS = {
	ownerUserId: null,
	fallbackBookingLink: null,
} as const satisfies CalendarSettings;

const storedCalendarSettings = calendarSettings.partial();

export function parseCalendarSettings(value: unknown): CalendarSettings {
	if (value === null || value === undefined) {
		return { ...DEFAULT_CALENDAR_SETTINGS };
	}
	const parsed = storedCalendarSettings.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`Unreadable calendar settings: ${parsed.error.issues
				.map(
					(issue) => `${issue.path.join(".") || "calendar"} ${issue.message}`,
				)
				.join("; ")}`,
		);
	}
	return { ...DEFAULT_CALENDAR_SETTINGS, ...parsed.data };
}
