"use client";

import Checkmark from "@carbon/icons-react/es/Checkmark";
import Forum from "@carbon/icons-react/es/Forum";
import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Bubble, BubbleContent, BubbleGroup } from "@crm/ui/components/bubble";
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
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { SmsComposer } from "@/components/crm/sms-composer";
import { LocalDateTime } from "@/components/local-date-time";
import {
	smsComposerBlock,
	smsFailed,
	smsStatus,
	smsThreadNotices,
} from "@/lib/sms-presentation";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type SmsMessage = RouterOutputs["sms"]["thread"]["messages"][number];

const TIME_OPTIONS = {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions;

export function SmsThread({ contactId }: { contactId: string }) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const thread = useQuery(trpc.sms.thread.queryOptions({ contactId }));

	const markHandled = useMutation(
		trpc.sms.markHandled.mutationOptions({
			onSuccess: async ({ updated }) => {
				await cache.sms();
				toast.success(
					updated === 1
						? "1 message marked handled."
						: `${updated} messages marked handled.`,
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (thread.isPending) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<Spinner />
			</div>
		);
	}

	if (thread.error) {
		return (
			<Alert variant="destructive">
				<AlertTitle>Could not load the texts</AlertTitle>
				<AlertDescription>{thread.error.message}</AlertDescription>
			</Alert>
		);
	}

	const data = thread.data;
	const notices = smsThreadNotices(data);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4">
			<div className="flex items-center justify-between gap-3">
				<p className="text-muted-foreground text-xs">
					{data.phone ?? "No phone number"}
					{data.openCount > 0
						? ` · ${data.openCount} waiting for a reply`
						: " · Nothing waiting"}
				</p>
				<Button
					variant="outline"
					size="sm"
					disabled={data.openCount === 0 || markHandled.isPending}
					onClick={() => markHandled.mutate({ contactId })}
				>
					{markHandled.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<Icon icon={Checkmark} data-icon="inline-start" />
					)}
					Mark handled
				</Button>
			</div>

			{data.attention ? (
				<Alert variant="warning">
					<AlertTitle>Needs you</AlertTitle>
					<AlertDescription>{data.attention}</AlertDescription>
				</Alert>
			) : null}

			{notices.map((notice) => (
				<Alert key={notice.title} variant={notice.tone}>
					<AlertTitle>{notice.title}</AlertTitle>
					<AlertDescription>{notice.description}</AlertDescription>
				</Alert>
			))}

			{data.truncated ? (
				<p className="text-center text-muted-foreground text-xs">
					Showing the most recent {data.messages.length} messages.
				</p>
			) : null}

			{data.messages.length === 0 ? (
				<Empty className="flex-1">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Icon icon={Forum} />
						</EmptyMedia>
						<EmptyTitle>No texts yet</EmptyTitle>
						<EmptyDescription>
							Texts to and from this contact show up here.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<BubbleGroup>
					{data.messages.map((message) => (
						<SmsBubble key={message.id} message={message} />
					))}
				</BubbleGroup>
			)}

			<SmsComposer
				contactId={contactId}
				blockedReason={smsComposerBlock(data)}
			/>
		</div>
	);
}

function SmsBubble({ message }: { message: SmsMessage }) {
	const outbound = message.direction === "OUTBOUND";
	const status = smsStatus(message.status);
	const failed = smsFailed(message.status);
	const open = !outbound && message.handledAt === null;

	return (
		<Bubble
			align={outbound ? "end" : "start"}
			variant={failed ? "destructive" : outbound ? "default" : "muted"}
		>
			<BubbleContent>
				<p className="whitespace-pre-wrap">{message.body}</p>
			</BubbleContent>
			<div className="flex items-center gap-2 text-muted-foreground text-xs group-data-[align=end]/bubble:self-end">
				<LocalDateTime date={message.createdAt} options={TIME_OPTIONS} />
				{outbound ? (
					<StatusIndicator
						size="sm"
						tone={status.tone}
						label={
							message.errorCode
								? `${status.label} (${message.errorCode})`
								: status.label
						}
					/>
				) : open ? (
					<StatusIndicator size="sm" tone="primary" label="Waiting" />
				) : null}
			</div>
		</Bubble>
	);
}
