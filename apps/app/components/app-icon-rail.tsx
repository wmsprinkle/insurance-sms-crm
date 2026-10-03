"use client";

import Building from "@carbon/icons-react/es/Building";
import Calendar from "@carbon/icons-react/es/Calendar";
import Close from "@carbon/icons-react/es/Close";
import Dashboard from "@carbon/icons-react/es/Dashboard";
import Forum from "@carbon/icons-react/es/Forum";
import Partnership from "@carbon/icons-react/es/Partnership";
import Settings from "@carbon/icons-react/es/Settings";
import UserMultiple from "@carbon/icons-react/es/UserMultiple";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import Bot from "@crm/ui/components/icons/bot";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@crm/ui/components/sheet";
import { cn } from "@crm/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { AgentBuilderSidebar } from "@/components/agent-builder/agent-builder-sidebar";
import { usePrefetchSection } from "@/components/crm/section-prefetch";
import { useMobileNav } from "@/components/mobile-nav";
import { isNavActive, type NavItem } from "@/lib/navigation";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

type RailItem = NavItem & { iconClassName?: string };

const PRIMARY_ITEMS: RailItem[] = [
	{ id: "today", title: "Today", href: "/", icon: Dashboard, match: "exact" },
	{
		id: "leads",
		title: "Leads",
		href: "/leads",
		icon: UserMultiple,
		match: "prefix",
	},
	{ id: "inbox", title: "Inbox", href: "/inbox", icon: Forum, match: "prefix" },
	{
		id: "meetings",
		title: "Meetings",
		href: "/meetings",
		icon: Calendar,
		match: "prefix",
	},
];

const UPSTREAM_ITEMS: RailItem[] = [
	{
		id: "chat",
		title: "Chat",
		href: "/chat",
		icon: Bot,
		iconClassName: "size-5",
		match: "prefix",
		related: ["/agents"],
	},
	{
		id: "companies",
		title: "Companies",
		href: "/companies",
		icon: Building,
		match: "prefix",
	},
	{
		id: "contacts",
		title: "Contacts",
		href: "/contacts",
		icon: UserMultiple,
		match: "prefix",
	},
	{
		id: "deals",
		title: "Deals",
		href: "/deals",
		icon: Partnership,
		match: "prefix",
	},
];

const SETTINGS_ITEM: RailItem = {
	id: "settings",
	title: "Settings",
	href: "/settings",
	icon: Settings,
	match: "prefix",
};

function railItems(showUpstream: boolean): RailItem[] {
	return [
		...PRIMARY_ITEMS,
		...(showUpstream ? UPSTREAM_ITEMS : []),
		SETTINGS_ITEM,
	];
}

function isActive(item: RailItem, pathname: string): boolean {
	return isNavActive(item, pathname);
}

function RailLink({
	item,
	active,
	onPrefetch,
}: {
	item: RailItem;
	active: boolean;
	onPrefetch: () => void;
}) {
	return (
		<Button
			asChild
			variant="ghost"
			className={cn(
				"w-full justify-start gap-3 px-3 font-normal text-muted-foreground",
				active &&
					"bg-muted font-medium text-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			<Link
				href={item.href}
				prefetch
				onMouseEnter={onPrefetch}
				onFocus={onPrefetch}
				aria-current={active ? "page" : undefined}
				transitionTypes={["nav-lateral"]}
			>
				<Icon icon={item.icon} className={item.iconClassName} />
				<span>{item.title}</span>
			</Link>
		</Button>
	);
}

function MobileRailLink({
	item,
	active,
	onNavigate,
	onPrefetch,
}: {
	item: RailItem;
	active: boolean;
	onNavigate: () => void;
	onPrefetch: () => void;
}) {
	return (
		<Button
			asChild
			variant="ghost"
			className={cn(
				"justify-start gap-3 text-muted-foreground",
				active &&
					"bg-muted text-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			<Link
				href={item.href}
				prefetch
				onMouseEnter={onPrefetch}
				onFocus={onPrefetch}
				aria-current={active ? "page" : undefined}
				onClick={onNavigate}
				transitionTypes={[item.id === "chat" ? "nav-forward" : "nav-lateral"]}
			>
				<Icon icon={item.icon} className={item.iconClassName} />
				<span>{item.title}</span>
			</Link>
		</Button>
	);
}

function MobileRailIconLink({
	item,
	active,
	onNavigate,
	onPrefetch,
}: {
	item: RailItem;
	active: boolean;
	onNavigate: () => void;
	onPrefetch: () => void;
}) {
	return (
		<Button
			asChild
			variant="ghost"
			size="icon"
			className={cn(
				"text-muted-foreground",
				active &&
					"bg-muted text-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			<Link
				href={item.href}
				prefetch
				onMouseEnter={onPrefetch}
				onFocus={onPrefetch}
				aria-current={active ? "page" : undefined}
				onClick={onNavigate}
			>
				<Icon icon={item.icon} className={item.iconClassName} />
				<span className="sr-only">{item.title}</span>
			</Link>
		</Button>
	);
}

const DESKTOP_NAV_CLASS =
	"hidden w-48 shrink-0 flex-col gap-0.5 border-r p-3 md:flex [view-transition-name:app-rail]";

export function AppIconRailFallback() {
	return (
		<nav aria-label="Primary" aria-busy="true" className={DESKTOP_NAV_CLASS}>
			{railItems(false).map((item) => (
				<Button
					key={item.id}
					variant="ghost"
					disabled
					className="w-full justify-start gap-3 px-3 font-normal text-muted-foreground"
				>
					<Icon icon={item.icon} className={item.iconClassName} />
					<span>{item.title}</span>
				</Button>
			))}
		</nav>
	);
}

export function AppIconRail({
	showUpstream = false,
}: {
	showUpstream?: boolean;
}) {
	const pathname = usePathname();
	const workspaceUrl = useWorkspaceUrl();
	const { open, setOpen } = useMobileNav();
	const prefetchSection = usePrefetchSection();

	const items = useMemo(
		() =>
			railItems(showUpstream).map((item) => ({
				...item,
				section: item.href,
				href: workspaceUrl(item.href),
				related: item.related?.map((path) => workspaceUrl(path)),
			})),
		[workspaceUrl, showUpstream],
	);
	const inChat = items.some(
		(item) => item.id === "chat" && isActive(item, pathname),
	);

	return (
		<>
			<nav aria-label="Primary" className={DESKTOP_NAV_CLASS}>
				{items.map((item) => (
					<RailLink
						key={item.id}
						item={item}
						active={isActive(item, pathname)}
						onPrefetch={() => prefetchSection(item.section)}
					/>
				))}
			</nav>

			<Sheet open={open} onOpenChange={setOpen}>
				{inChat ? (
					<SheetContent
						side="left"
						showCloseButton={false}
						className="w-5/6 max-w-sm flex-row gap-0 p-0"
					>
						<SheetHeader className="sr-only">
							<SheetTitle>Navigation and agent chats</SheetTitle>
						</SheetHeader>
						<nav
							aria-label="Primary"
							className="flex w-14 shrink-0 flex-col items-center gap-1 border-r py-3"
						>
							<Button
								variant="ghost"
								size="icon"
								aria-label="Close navigation"
								onClick={() => setOpen(false)}
							>
								<Icon icon={Close} />
							</Button>
							<div className="my-1 h-px w-5 bg-border" />
							{items.map((item) => (
								<MobileRailIconLink
									key={item.id}
									item={item}
									active={isActive(item, pathname)}
									onNavigate={() => setOpen(false)}
									onPrefetch={() => prefetchSection(item.section)}
								/>
							))}
						</nav>
						<AgentBuilderSidebar
							className="flex flex-1"
							onNavigate={() => setOpen(false)}
						/>
					</SheetContent>
				) : (
					<SheetContent side="left" className="w-64 gap-0 p-0">
						<SheetHeader>
							<SheetTitle>Navigation</SheetTitle>
						</SheetHeader>
						<nav
							aria-label="Primary"
							className="flex flex-1 flex-col gap-1 p-2"
						>
							{items.map((item) => (
								<MobileRailLink
									key={item.id}
									item={item}
									active={isActive(item, pathname)}
									onNavigate={() => setOpen(false)}
									onPrefetch={() => prefetchSection(item.section)}
								/>
							))}
						</nav>
					</SheetContent>
				)}
			</Sheet>
		</>
	);
}
