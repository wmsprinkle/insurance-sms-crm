export const TIMELINE_KINDS = [
	"imported",
	"consent",
	"sent",
	"replied",
	"handoff",
	"draft",
	"booked",
	"opted_out",
] as const;

export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export type TimelineEvent = { at: Date; kind: TimelineKind; label: string };

export function sortTimeline(
	events: readonly TimelineEvent[],
	limit: number,
): TimelineEvent[] {
	return [...events]
		.sort((a, b) => a.at.getTime() - b.at.getTime())
		.slice(-limit);
}

export function messageLabel(direction: "INBOUND" | "OUTBOUND"): {
	kind: TimelineKind;
	label: string;
} {
	return direction === "INBOUND"
		? { kind: "replied", label: "The lead replied" }
		: { kind: "sent", label: "A text was sent" };
}
