"use client";

import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Spinner } from "@crm/ui/components/spinner";
import { Switch } from "@crm/ui/components/switch";
import { Textarea } from "@crm/ui/components/textarea";
import {
	firstMessageTemplate,
	SMS_DISCLOSURE_MODES,
	SMS_SETTINGS_LIMITS,
	SMS_TEMPLATE_TOKENS,
	type SmsDisclosureMode,
	type SmsSettings,
} from "@crm/validation/sms-settings";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

const DISCLOSURE_LABELS = {
	disclose: "Disclose: say it is an automated assistant",
	deflect: "Deflect: steer back to the topic without claiming to be human",
} satisfies Record<SmsDisclosureMode, string>;

function isDisclosureMode(value: string): value is SmsDisclosureMode {
	return SMS_DISCLOSURE_MODES.some((mode) => mode === value);
}

function sameSettings(a: SmsSettings, b: SmsSettings): boolean {
	return (
		a.firstMessageTemplate === b.firstMessageTemplate &&
		a.disclosureMode === b.disclosureMode &&
		a.autoSend === b.autoSend
	);
}

export function SmsSettingsForm() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const templateId = useId();
	const disclosureId = useId();
	const autoSendId = useId();

	const sms = useQuery(trpc.settings.sms.queryOptions());
	const [draft, setDraft] = useState<SmsSettings | null>(null);

	useEffect(() => {
		if (sms.data) setDraft(sms.data.settings);
	}, [sms.data]);

	const save = useMutation(
		trpc.settings.setSms.mutationOptions({
			onSuccess: async () => {
				await cache.settings();
				toast.success("Texting settings saved.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!sms.data || !draft) return null;

	const templateCheck = firstMessageTemplate.safeParse(
		draft.firstMessageTemplate,
	);
	const templateError = templateCheck.success
		? null
		: (templateCheck.error.issues[0]?.message ?? null);
	const unchanged = sameSettings(draft, sms.data.settings);
	const defaults = sms.data.defaults;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Texting</CardTitle>
				<CardDescription>
					Keep the first message close to the samples in your toll-free
					verification. Carriers compare them.
				</CardDescription>
				<CardAction>
					<Button
						type="submit"
						form="sms-settings"
						disabled={save.isPending || unchanged || templateError !== null}
					>
						{save.isPending ? <Spinner data-icon="inline-start" /> : null}
						Save
					</Button>
				</CardAction>
			</CardHeader>

			<CardContent>
				<form
					id="sms-settings"
					onSubmit={(event) => {
						event.preventDefault();
						if (templateError) {
							toast.error(templateError);
							return;
						}
						save.mutate(draft);
					}}
				>
					<FieldGroup>
						<Field data-invalid={templateError !== null}>
							<FieldLabel htmlFor={templateId}>First message</FieldLabel>
							<Textarea
								id={templateId}
								rows={4}
								value={draft.firstMessageTemplate}
								disabled={save.isPending}
								aria-invalid={templateError !== null}
								onChange={(event) =>
									setDraft({
										...draft,
										firstMessageTemplate: event.target.value,
									})
								}
							/>
							<FieldDescription>
								{SMS_TEMPLATE_TOKENS.firstName} becomes the lead's first name
								and {SMS_TEMPLATE_TOKENS.agency} your workspace name. Must
								include "Reply STOP to opt out".{" "}
								{draft.firstMessageTemplate.length}/
								{SMS_SETTINGS_LIMITS.firstMessage.maxLength} characters.
							</FieldDescription>
							{templateError ? <FieldError>{templateError}</FieldError> : null}
							<div>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={
										save.isPending ||
										draft.firstMessageTemplate === defaults.firstMessageTemplate
									}
									onClick={() =>
										setDraft({
											...draft,
											firstMessageTemplate: defaults.firstMessageTemplate,
										})
									}
								>
									Use the default text
								</Button>
							</div>
						</Field>

						<Field>
							<FieldLabel htmlFor={disclosureId}>
								When a lead asks if they are talking to a bot
							</FieldLabel>
							<Select
								value={draft.disclosureMode}
								disabled={save.isPending}
								onValueChange={(next) => {
									if (isDisclosureMode(next)) {
										setDraft({ ...draft, disclosureMode: next });
									}
								}}
							>
								<SelectTrigger id={disclosureId} className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{SMS_DISCLOSURE_MODES.map((mode) => (
										<SelectItem key={mode} value={mode}>
											{DISCLOSURE_LABELS[mode]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<FieldDescription>
								Disclose is the default. Some states require it.
							</FieldDescription>
						</Field>

						<Field orientation="horizontal">
							<FieldContent>
								<FieldLabel htmlFor={autoSendId}>
									Send replies automatically
								</FieldLabel>
								<FieldDescription>
									Off: every reply the agent writes waits as a draft for
									approval. On: replies go out without review, still inside the
									allowed hours.
								</FieldDescription>
							</FieldContent>
							<Switch
								id={autoSendId}
								checked={draft.autoSend}
								disabled={save.isPending}
								onCheckedChange={(autoSend) => setDraft({ ...draft, autoSend })}
							/>
						</Field>
					</FieldGroup>
				</form>
			</CardContent>
		</Card>
	);
}
