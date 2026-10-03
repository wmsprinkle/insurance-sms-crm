"use client";

import ChevronDown from "@carbon/icons-react/es/ChevronDown";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@crm/ui/components/collapsible";
import { Icon } from "@crm/ui/components/icon";
import { useQuery } from "@tanstack/react-query";
import { frequencyCapText } from "@/lib/sms-settings-fields";
import { useTRPC } from "@/lib/trpc/client";
import { QuietHours } from "./quiet-hours";

export function LimitsSection() {
	const trpc = useTRPC();
	const limits = useQuery(trpc.settings.complianceLimits.queryOptions());

	return (
		<Collapsible>
			<Card>
				<CardHeader>
					<CardTitle>Limits and quiet hours</CardTitle>
					<CardDescription>
						Built-in rules that protect your leads and your number. You cannot
						change them here.
					</CardDescription>
					<CollapsibleTrigger asChild>
						<Button variant="outline" size="sm" className="w-fit">
							Show the rules
							<Icon icon={ChevronDown} data-icon="inline-end" />
						</Button>
					</CollapsibleTrigger>
				</CardHeader>
				<CollapsibleContent>
					<CardContent className="flex flex-col gap-4">
						{limits.data ? (
							<p className="text-sm">
								<span className="font-medium">Frequency cap. </span>
								{frequencyCapText(limits.data.frequency)}
							</p>
						) : null}
						<QuietHours />
					</CardContent>
				</CollapsibleContent>
			</Card>
		</Collapsible>
	);
}
