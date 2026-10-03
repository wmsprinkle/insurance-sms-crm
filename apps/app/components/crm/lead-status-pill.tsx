import { Badge } from "@crm/ui/components/badge";
import { IndicatorDot } from "@crm/ui/components/status-indicator";
import { type LeadStatus, leadStatusMeta } from "@/lib/lead-status";

export function LeadStatusPill({ status }: { status: LeadStatus }) {
	const meta = leadStatusMeta(status);

	return (
		<Badge variant="outline" title={meta.help}>
			<IndicatorDot tone={meta.tone} />
			{meta.label}
		</Badge>
	);
}
