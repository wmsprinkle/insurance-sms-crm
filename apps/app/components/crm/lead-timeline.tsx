import { IndicatorDot } from "@crm/ui/components/status-indicator";
import { LocalDateTime, LocalRelativeTime } from "@/components/local-date-time";
import { TIMELINE_DOT } from "@/lib/leads";
import type { RouterOutputs } from "@/lib/trpc/types";

type TimelineEvent = RouterOutputs["today"]["lead"]["timeline"][number];

const WHEN_OPTIONS = {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions;

export function LeadTimeline({ events }: { events: TimelineEvent[] }) {
	return (
		<ol className="flex flex-col gap-3">
			{events.map((event, index) => (
				<li
					key={`${event.at}-${event.kind}-${index.toString()}`}
					className="flex gap-3"
				>
					<IndicatorDot tone={TIMELINE_DOT[event.kind]} className="mt-1.5" />
					<div className="flex min-w-0 flex-col">
						<span className="text-sm">{event.label}</span>
						<span className="text-muted-foreground text-xs">
							<LocalDateTime date={event.at} options={WHEN_OPTIONS} /> ·{" "}
							<LocalRelativeTime date={event.at} />
						</span>
					</div>
				</li>
			))}
		</ol>
	);
}
