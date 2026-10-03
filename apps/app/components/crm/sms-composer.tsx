"use client";

import Send from "@carbon/icons-react/es/Send";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { Spinner } from "@crm/ui/components/spinner";
import { Textarea } from "@crm/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { SmsOutcomeAlert } from "@/components/crm/sms-outcome-alert";
import {
	type SmsOutcomeNotice,
	smsOutcomeNotice,
	smsTextProblem,
} from "@/lib/sms-drafts";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

export function SmsComposer({
	contactId,
	blockedReason,
}: {
	contactId: string;
	blockedReason: string | null;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const queryClient = useQueryClient();
	const [text, setText] = useState("");
	const [key, setKey] = useState(() => crypto.randomUUID());
	const [notice, setNotice] = useState<SmsOutcomeNotice | null>(null);

	const send = useMutation(
		trpc.smsDrafts.compose.mutationOptions({
			onSuccess: async (outcome) => {
				const next = smsOutcomeNotice(outcome);
				if (!next.sent) {
					setNotice(next);
					return;
				}
				setNotice(null);
				setText("");
				setKey(crypto.randomUUID());
				toast.success(next.title);
				await Promise.all([
					cache.sms(),
					queryClient.invalidateQueries({
						queryKey: trpc.smsDrafts.pathKey(),
					}),
				]);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const problem = smsTextProblem(text);
	const disabled = blockedReason !== null || send.isPending;

	const submit = () => {
		if (problem || disabled) return;
		send.mutate({ contactId, text: text.trim(), idempotencyKey: key });
	};

	return (
		<div className="flex flex-col gap-2 border-t pt-3">
			{notice ? (
				<SmsOutcomeAlert
					notice={notice}
					onUseSuggestion={(suggestion) => {
						setText(suggestion);
						setKey(crypto.randomUUID());
						setNotice(null);
					}}
				/>
			) : null}
			<Textarea
				aria-label="Text message"
				placeholder={
					blockedReason ?? "Write a text. It goes through the send gate."
				}
				value={text}
				disabled={blockedReason !== null}
				onChange={(event) => {
					setText(event.target.value);
					setKey(crypto.randomUUID());
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						submit();
					}
				}}
			/>
			<div className="flex items-center justify-between gap-3">
				<p className="text-muted-foreground text-xs">
					{text.trim() ? (problem ?? "Ctrl or Cmd + Enter sends.") : ""}
				</p>
				<Button
					size="sm"
					disabled={disabled || problem !== null}
					onClick={submit}
				>
					{send.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<Icon icon={Send} data-icon="inline-start" />
					)}
					Send
				</Button>
			</div>
		</div>
	);
}
