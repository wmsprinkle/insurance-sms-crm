import type { CarbonIcon } from "@crm/ui/components/icon";

export type NavItem = {
	id: string;
	title: string;
	href: string;
	icon: CarbonIcon;
	match: "exact" | "prefix";
	related?: string[];
};

export function isNavActive(
	item: Pick<NavItem, "href" | "match" | "related">,
	pathname: string,
): boolean {
	return (
		pathname === item.href ||
		(item.match === "prefix" && pathname.startsWith(`${item.href}/`)) ||
		Boolean(
			item.related?.some(
				(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
			),
		)
	);
}
