"use client";

import Calendar from "@carbon/icons-react/es/Calendar";
import Video from "@carbon/icons-react/es/Video";
import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Button } from "@crm/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@crm/ui/components/empty";
import { Icon } from "@crm/ui/components/icon";
import { Spinner } from "@crm/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

type Meeting = RouterOutputs["today"]["meetings"]["upcoming"][number];

const MEETING_TIME = {
	weekday: "short",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions;

export function MeetingsList() {
	const trpc = useTRPC();
	const meetings = useQuery(trpc.today.meetings.queryOptions());

	if (meetings.isPending) {
		return (
			<div aria-busy="true" className="flex justify-center py-12">
				<Spinner size="lg" />
			</div>
		);
	}

	if (meetings.error) {
		return (
			<Alert variant="destructive">
				<AlertTitle>Could not load meetings</AlertTitle>
				<AlertDescription className="flex flex-col items-start gap-3">
					<span>{meetings.error.message}</span>
					<Button
						variant="outline"
						size="sm"
						onClick={() => void meetings.refetch()}
					>
						Try again
					</Button>
				</AlertDescription>
			</Alert>
		);
	}

	const { upcoming, past } = meetings.data;

	return (
		<div className="flex max-w-4xl flex-col gap-8">
			<MeetingSection
				id="upcoming-meetings"
				title="Upcoming"
				meetings={upcoming}
				empty={
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Icon icon={Calendar} />
							</EmptyMedia>
							<EmptyTitle>No meetings booked yet</EmptyTitle>
							<EmptyDescription>
								When a lead picks a time, the call shows up here and on your
								calendar. Connect Google Calendar in Settings so bookings can be
								made.
							</EmptyDescription>
						</EmptyHeader>
						<ConnectCalendarButton />
					</Empty>
				}
			/>
			{past.length > 0 ? (
				<MeetingSection id="past-meetings" title="Past" meetings={past} />
			) : null}
		</div>
	);
}

function ConnectCalendarButton() {
	const workspaceUrl = useWorkspaceUrl();

	return (
		<Button asChild>
			<Link href={workspaceUrl("/settings/connections")}>Connect calendar</Link>
		</Button>
	);
}

function MeetingSection({
	id,
	title,
	meetings,
	empty,
}: {
	id: string;
	title: string;
	meetings: Meeting[];
	empty?: React.ReactNode;
}) {
	const workspaceUrl = useWorkspaceUrl();

	return (
		<section aria-labelledby={id} className="flex flex-col gap-3">
			<h2 id={id} className="font-medium text-lg">
				{title}
			</h2>
			{meetings.length === 0 ? (
				empty
			) : (
				<ul className="flex flex-col gap-2">
					{meetings.map((meeting) => (
						<li
							key={meeting.id}
							className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
						>
							<div className="flex min-w-0 flex-col gap-0.5">
								<Link
									href={workspaceUrl(`/leads/${meeting.contactId}`)}
									className="truncate font-medium underline-offset-4 hover:underline"
								>
									{meeting.name || "Unnamed lead"}
								</Link>
								<span className="text-muted-foreground text-sm">
									<LocalDateTime
										date={meeting.startsAt}
										options={MEETING_TIME}
									/>
									{meeting.title ? ` · ${meeting.title}` : ""}
								</span>
								{meeting.phone ? (
									<span className="text-muted-foreground text-xs">
										{meeting.phone}
									</span>
								) : null}
							</div>
							<div className="flex shrink-0 items-center gap-2">
								{meeting.conferenceUrl ? (
									<Button asChild size="sm" variant="outline">
										<a
											href={meeting.conferenceUrl}
											target="_blank"
											rel="noreferrer"
										>
											<Icon icon={Video} data-icon="inline-start" />
											Join
										</a>
									</Button>
								) : null}
								<Button asChild size="sm" variant="ghost">
									<Link href={workspaceUrl(`/leads/${meeting.contactId}`)}>
										Open lead
									</Link>
								</Button>
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
