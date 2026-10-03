export const CALENDAR_OWNER_AUTO = "auto";

export function ownerOptionValue(ownerUserId: string | null): string {
	return ownerUserId ?? CALENDAR_OWNER_AUTO;
}
