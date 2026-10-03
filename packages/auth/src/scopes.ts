export const GOOGLE_PROVIDER_ID = "google";
export const MICROSOFT_PROVIDER_ID = "microsoft";
export const SLACK_PROVIDER_ID = "slack";

export const MAILBOX_PROVIDER_IDS = [
	GOOGLE_PROVIDER_ID,
	MICROSOFT_PROVIDER_ID,
] as const;

export type MailboxProviderId = (typeof MAILBOX_PROVIDER_IDS)[number];

export const IDENTITY_SCOPES = ["openid", "email", "profile"] as const;

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const CALENDAR_SCOPE =
	"https://www.googleapis.com/auth/calendar.readonly";
export const CALENDAR_EVENTS_SCOPE =
	"https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_FREEBUSY_SCOPE =
	"https://www.googleapis.com/auth/calendar.freebusy";
export const OUTLOOK_MAIL_SCOPE = "Mail.Read";

export const READ_SYNC_SCOPES = [GMAIL_SCOPE, CALENDAR_SCOPE] as const;
export const BOOKING_SCOPES = [
	CALENDAR_EVENTS_SCOPE,
	CALENDAR_FREEBUSY_SCOPE,
] as const;

export const SYNC_SCOPES = [...READ_SYNC_SCOPES, ...BOOKING_SCOPES] as const;
export const MICROSOFT_SYNC_SCOPES = [OUTLOOK_MAIL_SCOPE] as const;

export const SYNC_SCOPES_FOR = {
	[GOOGLE_PROVIDER_ID]: READ_SYNC_SCOPES,
	[MICROSOFT_PROVIDER_ID]: MICROSOFT_SYNC_SCOPES,
} satisfies Record<MailboxProviderId, readonly string[]>;

export const REQUIRED_SCOPES = [...IDENTITY_SCOPES, ...SYNC_SCOPES] as const;

const GRAPH_SCOPE_PREFIX = "https://graph.microsoft.com/";

export function isMailboxProvider(
	providerId: string,
): providerId is MailboxProviderId {
	return (MAILBOX_PROVIDER_IDS as readonly string[]).includes(providerId);
}

export function hasSyncScopes(
	providerId: string,
	scope: string | null | undefined,
): boolean {
	if (!isMailboxProvider(providerId)) return false;

	const granted = parseScopes(scope);
	return SYNC_SCOPES_FOR[providerId].every((needed) => granted.has(needed));
}

export function missingBookingScopes(
	scope: string | null | undefined,
): string[] {
	const granted = parseScopes(scope);
	return BOOKING_SCOPES.filter((needed) => !granted.has(needed));
}

export function hasBookingScopes(scope: string | null | undefined): boolean {
	return missingBookingScopes(scope).length === 0;
}

export type SignInAccount = {
	providerId: string;
	scope?: string | null;
};

export function signsInOnlyWith(
	accounts: readonly SignInAccount[],
	providerId: string,
): boolean {
	return (
		accounts.length > 0 &&
		accounts.every((account) => account.providerId === providerId)
	);
}

export function signsInWithGoogle(accounts: readonly SignInAccount[]): boolean {
	return signsInOnlyWith(accounts, GOOGLE_PROVIDER_ID);
}

export function signsInWithMicrosoft(
	accounts: readonly SignInAccount[],
): boolean {
	return signsInOnlyWith(accounts, MICROSOFT_PROVIDER_ID);
}

export function mailboxGrantsNeeded(
	accounts: readonly SignInAccount[],
): MailboxProviderId[] {
	const everyRowIsAMailbox =
		accounts.length > 0 &&
		accounts.every((account) => isMailboxProvider(account.providerId));

	if (!everyRowIsAMailbox) return [];

	const granted = accounts.some((account) =>
		hasSyncScopes(account.providerId, account.scope),
	);
	if (granted) return [];

	return [
		...new Set(
			accounts.map((account) => account.providerId).filter(isMailboxProvider),
		),
	];
}

export function needsMailboxGrant(accounts: readonly SignInAccount[]): boolean {
	return mailboxGrantsNeeded(accounts).length > 0;
}

export function needsBookingGrant(accounts: readonly SignInAccount[]): boolean {
	const google = accounts.filter(
		(account) => account.providerId === GOOGLE_PROVIDER_ID,
	);

	return (
		google.length > 0 &&
		google.some((account) =>
			hasSyncScopes(GOOGLE_PROVIDER_ID, account.scope),
		) &&
		!google.some((account) => hasBookingScopes(account.scope))
	);
}

export function parseScopes(scope: string | null | undefined): Set<string> {
	return new Set(
		(scope ?? "")
			.split(/[,\s]+/)
			.map((entry) => entry.trim())
			.filter(Boolean)
			.map((entry) =>
				entry.startsWith(GRAPH_SCOPE_PREFIX)
					? entry.slice(GRAPH_SCOPE_PREFIX.length)
					: entry,
			),
	);
}
