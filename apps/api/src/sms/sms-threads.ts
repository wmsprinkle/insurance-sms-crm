import type { Prisma } from "@crm/db";

type NamedContact = { firstName: string; lastName: string | null };

export function contactDisplayName(contact: NamedContact): string {
	return [contact.firstName, contact.lastName]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join(" ");
}

export function previewOf(body: string, length: number): string {
	const flat = body.replace(/\s+/g, " ").trim();
	return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

export function threadSearch(q: string): Prisma.ContactWhereInput {
	const term = q.trim();
	if (!term) return { archivedAt: null };

	const digits = term.replace(/\D/g, "");
	const matches: Prisma.ContactWhereInput[] = [
		{ firstName: { contains: term, mode: "insensitive" } },
		{ lastName: { contains: term, mode: "insensitive" } },
	];
	if (digits) matches.push({ phone: { contains: digits } });

	return { archivedAt: null, OR: matches };
}
