import type { Prisma } from "@crm/db";
import { COMPLIANCE } from "./compliance-config";

export type RetainedContact = {
	firstName: string;
	lastName: string | null;
	phone: string | null;
};

export function retainUntil(purgedAt: Date): Date {
	const until = new Date(purgedAt);
	until.setUTCFullYear(until.getUTCFullYear() + COMPLIANCE.retention.years);
	return until;
}

export function retainedConsentSnapshot(
	contactId: string,
	contact: RetainedContact,
	purgedAt: Date,
): Prisma.InputJsonObject {
	return {
		contactId,
		firstName: contact.firstName,
		lastName: contact.lastName,
		phone: contact.phone,
		purgedAt: purgedAt.toISOString(),
		retainUntil: retainUntil(purgedAt).toISOString(),
		note: COMPLIANCE.retention.note,
	};
}
