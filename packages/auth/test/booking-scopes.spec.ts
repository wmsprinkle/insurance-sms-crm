import { describe, expect, it } from "bun:test";
import {
	BOOKING_SCOPES,
	CALENDAR_EVENTS_SCOPE,
	CALENDAR_FREEBUSY_SCOPE,
	CALENDAR_SCOPE,
	GMAIL_SCOPE,
	hasBookingScopes,
	hasSyncScopes,
	missingBookingScopes,
	needsBookingGrant,
	needsMailboxGrant,
	READ_SYNC_SCOPES,
	SYNC_SCOPES,
} from "../src/scopes";

const READ_ONLY = `openid,email,${GMAIL_SCOPE},${CALENDAR_SCOPE}`;
const UPGRADED = `${READ_ONLY},${CALENDAR_EVENTS_SCOPE},${CALENDAR_FREEBUSY_SCOPE}`;

describe("Google booking scopes", () => {
	it("requests the read scopes and the booking scopes together", () => {
		expect([...SYNC_SCOPES]).toEqual([...READ_SYNC_SCOPES, ...BOOKING_SCOPES]);
		expect(SYNC_SCOPES).toContain(CALENDAR_EVENTS_SCOPE);
		expect(SYNC_SCOPES).toContain(CALENDAR_FREEBUSY_SCOPE);
	});

	it("keeps read-only sync working for an account granted before the upgrade", () => {
		expect(hasSyncScopes("google", READ_ONLY)).toBe(true);
		expect(
			needsMailboxGrant([{ providerId: "google", scope: READ_ONLY }]),
		).toBe(false);
	});

	it("lists the booking scopes a read-only account lacks", () => {
		expect(missingBookingScopes(READ_ONLY)).toEqual([...BOOKING_SCOPES]);
		expect(
			missingBookingScopes(`${READ_ONLY} ${CALENDAR_EVENTS_SCOPE}`),
		).toEqual([CALENDAR_FREEBUSY_SCOPE]);
		expect(hasBookingScopes(UPGRADED)).toBe(true);
	});

	it("does not match a booking scope on a prefix", () => {
		expect(hasBookingScopes(`${CALENDAR_EVENTS_SCOPE}.owned`)).toBe(false);
	});

	it("asks a synced Google account without booking scopes to re-consent", () => {
		expect(
			needsBookingGrant([{ providerId: "google", scope: READ_ONLY }]),
		).toBe(true);
	});

	it("stops asking once the booking scopes are granted", () => {
		expect(needsBookingGrant([{ providerId: "google", scope: UPGRADED }])).toBe(
			false,
		);
	});

	it("leaves the mailbox wall to handle an account with no sync grant", () => {
		expect(
			needsBookingGrant([{ providerId: "google", scope: "openid,email" }]),
		).toBe(false);
	});

	it("never asks an account that has no Google row", () => {
		expect(needsBookingGrant([{ providerId: "okta", scope: null }])).toBe(
			false,
		);
		expect(
			needsBookingGrant([{ providerId: "microsoft", scope: "Mail.Read" }]),
		).toBe(false);
	});
});
