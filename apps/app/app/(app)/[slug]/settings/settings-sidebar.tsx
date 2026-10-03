"use client";

import { Button } from "@crm/ui/components/button";
import { cn } from "@crm/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

type SettingsNavItem = {
	title: string;
	href: string;
	upstream?: boolean;
};

const ROOT = "/settings";

const ITEMS: SettingsNavItem[] = [
	{ title: "General", href: ROOT },
	{ title: "Compliance", href: `${ROOT}/compliance` },
	{ title: "Connections", href: `${ROOT}/connections` },
	{ title: "Members", href: `${ROOT}/members` },
	{ title: "Tracking & Analytics", href: `${ROOT}/tracking`, upstream: true },
	{ title: "Currencies", href: `${ROOT}/currencies`, upstream: true },
	{ title: "API Keys", href: `${ROOT}/api-keys`, upstream: true },
	{ title: "SSO", href: `${ROOT}/sso`, upstream: true },
];

function isActive(href: string, root: string, pathname: string): boolean {
	return href === root ? pathname === href : pathname.startsWith(href);
}

function NavLink({
	item,
	active,
	className,
}: {
	item: SettingsNavItem;
	active: boolean;
	className: string;
}) {
	return (
		<Button
			asChild
			variant="ghost"
			className={cn(
				"justify-start font-normal text-muted-foreground",
				active &&
					"bg-muted text-foreground hover:bg-muted hover:text-foreground",
				className,
			)}
		>
			<Link
				href={item.href}
				prefetch
				aria-current={active ? "page" : undefined}
				transitionTypes={["nav-lateral"]}
			>
				{item.title}
			</Link>
		</Button>
	);
}

export function SettingsSidebarFallback() {
	const shown = ITEMS.filter((item) => !item.upstream);
	return (
		<>
			<aside className="hidden w-56 shrink-0 border-r md:block [view-transition-name:settings-sidebar]">
				<nav
					aria-label="Workspace settings"
					aria-busy="true"
					className="flex flex-col gap-0.5 p-3"
				>
					{shown.map((item) => (
						<Button
							key={item.href}
							variant="ghost"
							disabled
							className="w-full justify-start px-3 font-normal text-muted-foreground"
						>
							{item.title}
						</Button>
					))}
				</nav>
			</aside>

			<nav
				aria-label="Workspace settings"
				aria-busy="true"
				className="flex gap-1 overflow-x-auto border-b p-2 md:hidden [view-transition-name:settings-sidebar]"
			>
				{shown.map((item) => (
					<Button
						key={item.href}
						variant="ghost"
						disabled
						className="shrink-0 justify-start px-3 font-normal text-muted-foreground"
					>
						{item.title}
					</Button>
				))}
			</nav>
		</>
	);
}

export function SettingsSidebar({
	showUpstream = false,
}: {
	showUpstream?: boolean;
}) {
	const pathname = usePathname();
	const workspaceUrl = useWorkspaceUrl();

	const root = workspaceUrl(ROOT);
	const items = useMemo(
		() =>
			ITEMS.filter((item) => showUpstream || !item.upstream).map((item) => ({
				...item,
				href: workspaceUrl(item.href),
			})),
		[workspaceUrl, showUpstream],
	);

	return (
		<>
			<aside className="hidden w-56 shrink-0 border-r md:block [view-transition-name:settings-sidebar]">
				<nav
					aria-label="Workspace settings"
					className="flex flex-col gap-0.5 p-3"
				>
					{items.map((item) => (
						<NavLink
							key={item.href}
							item={item}
							active={isActive(item.href, root, pathname)}
							className="w-full px-3"
						/>
					))}
				</nav>
			</aside>

			<nav
				aria-label="Workspace settings"
				className="flex gap-1 overflow-x-auto border-b p-2 md:hidden [view-transition-name:settings-sidebar]"
			>
				{items.map((item) => (
					<NavLink
						key={item.href}
						item={item}
						active={isActive(item.href, root, pathname)}
						className="shrink-0 px-3"
					/>
				))}
			</nav>
		</>
	);
}
