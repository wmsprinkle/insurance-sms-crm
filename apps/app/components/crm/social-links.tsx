import { Button } from "@crm/ui/components/button";
import type { CarbonIcon } from "@crm/ui/components/icon";
import { Icon } from "@crm/ui/components/icon";
import { safeHttpUrl } from "@/lib/safe-url";
import {
	type CompanyLinks,
	type ContactLinks,
	companySocialLinks,
	contactSocialLinks,
} from "@/lib/social-links";

function SocialLinks({
	rows,
}: {
	rows: Array<{
		key: PropertyKey;
		label: string;
		icon: CarbonIcon;
		href: string;
	}>;
}) {
	if (rows.length === 0) return null;

	return (
		<div className="flex flex-wrap items-center gap-2">
			{rows
				.filter((link) => safeHttpUrl(link.href) !== null)
				.map((link) => (
					<Button key={String(link.key)} asChild variant="outline" size="sm">
						<a
							href={safeHttpUrl(link.href) ?? undefined}
							target="_blank"
							rel="noreferrer noopener"
						>
							<Icon icon={link.icon} data-icon="inline-start" />
							{link.label}
						</a>
					</Button>
				))}
		</div>
	);
}

export function CompanySocials({ company }: { company: CompanyLinks }) {
	return <SocialLinks rows={companySocialLinks(company)} />;
}

export function ContactSocials({ contact }: { contact: ContactLinks }) {
	return <SocialLinks rows={contactSocialLinks(contact)} />;
}
