import type { Db, Prisma } from "@crm/db";
import { SETTINGS_ID } from "@crm/db/settings";
import { WORKSPACE_ID } from "@crm/db/workspace";
import { resolveBrand, smsSettings } from "@crm/validation/sms-settings";

const brandOnly = smsSettings.pick({ brandName: true }).partial();

type BrandReader =
	| Pick<Db, "appSetting" | "organization">
	| Prisma.TransactionClient;

export async function readBrand(db: BrandReader): Promise<string> {
	const [row, workspace] = await Promise.all([
		db.appSetting.findUnique({
			where: { id: SETTINGS_ID },
			select: { sms: true },
		}),
		db.organization.findUnique({
			where: { id: WORKSPACE_ID },
			select: { name: true },
		}),
	]);
	const stored = brandOnly.safeParse(row?.sms ?? {});
	return resolveBrand(
		stored.success ? (stored.data.brandName ?? "") : "",
		workspace?.name,
	);
}
