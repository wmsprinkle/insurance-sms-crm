import { Prisma } from "@crm/db";

export function isUniqueViolation(cause: unknown): boolean {
	return (
		cause instanceof Prisma.PrismaClientKnownRequestError &&
		cause.code === "P2002"
	);
}
