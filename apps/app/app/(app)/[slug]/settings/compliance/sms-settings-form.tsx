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
import { Input } from "@crm/ui/components/input";
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
	brandName,
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
import {
	frequencyCapText,
	parseStatesText,
	statesProblem,
	statesText,
} from "@/lib/sms-settings-fields";
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
		a.autoSend === b.autoSend &&
		a.brandName === b.brandName &&
		a.licensedStates.join() === b.licensedStates.join()
	);
}

export function SmsSettingsForm() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const templateId = useId();
	const disclosureId = useId();
	const autoSendId = useId();
	const brandId = useId();
	const statesId = useId();

	const sms = useQuery(trpc.settings.sms.queryOptions());
	const limits = useQuery(trpc.settings.complianceLimits.queryOptions());
	const [draft, setDraft] = useState<SmsSettings | null>(null);
	const [states, setStates] = useState("");

	useEffect(() => {
		if (sms.data) {
			setDraft(sms.data.settings);
			setStates(statesText(sms.data.settings.licensedStates));
		}
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
	const brandCheck = brandName.safeParse(draft.brandName);
	const brandError = brandCheck.success
		? null
		: (brandCheck.error.issues[0]?.message ?? null);
	const statesError = statesProblem(states);
	const next: SmsSettings = {
		...draft,
		licensedStates: parseStatesText(states),
	};
	const invalid =
		templateError !== null || brandError !== null || statesError !== null;
	const unchanged = sameSettings(next, sms.data.settings);
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
						disabled={save.isPending || unchanged || invalid}
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
						const problem = templateError ?? brandError ?? statesError;
						if (problem) {
							toast.error(problem);
							return;
						}
						save.mutate(next);
					}}
				>
					<FieldGroup>
						<Field data-invalid={brandError !== null}>
							<FieldLabel htmlFor={brandId}>Business name</FieldLabel>
							<Input
								id={brandId}
								value={draft.brandName}
								disabled={save.isPending}
								aria-invalid={brandError !== null}
								placeholder="Same as your workspace name"
								onChange={(event) =>
									setDraft({ ...draft, brandName: event.target.value })
								}
							/>
							<FieldDescription>
								The name leads see. It opens the first message, the booking
								confirmation, the first reply of each conversation and the STOP
								and HELP replies. Leave it empty to use the workspace name.
							</FieldDescription>
							{brandError ? <FieldError>{brandError}</FieldError> : null}
						</Field>

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

						<Field data-invalid={statesError !== null}>
							<FieldLabel htmlFor={statesId}>Licensed states</FieldLabel>
							<Input
								id={statesId}
								value={states}
								disabled={save.isPending}
								aria-invalid={statesError !== null}
								placeholder="TX, FL, GA"
								onChange={(event) => setStates(event.target.value)}
							/>
							<FieldDescription>
								Two-letter codes, separated by commas. A lead in any other state
								is not qualified. Leave it empty to accept every state.
							</FieldDescription>
							{statesError ? <FieldError>{statesError}</FieldError> : null}
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

						{limits.data ? (
							<Field>
								<FieldLabel>Frequency cap</FieldLabel>
								<FieldDescription>
									{frequencyCapText(limits.data.frequency)} This limit is built
									in and cannot be changed here.
								</FieldDescription>
							</Field>
						) : null}
					</FieldGroup>
				</form>
			</CardContent>
		</Card>
	);
}
