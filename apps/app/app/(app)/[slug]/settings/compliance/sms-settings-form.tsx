"use client";

import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import {
	Card,
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
import { Spinner } from "@crm/ui/components/spinner";
import { Switch } from "@crm/ui/components/switch";
import { Textarea } from "@crm/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import {
	SMS_AMBIGUOUS_MODES,
	SMS_DISCLOSURE_MODES,
	SMS_TEMPLATE_TOKENS,
	type SmsAmbiguousMode,
	type SmsDisclosureMode,
	type SmsSettings,
} from "@crm/validation/sms-settings";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import {
	autoSendChoice,
	brandProblem,
	firstMessagePreview,
	firstMessageProblem,
	parseStatesText,
	replyToneProblem,
	SMS_CHOICES,
	sameSmsSettings,
	statesProblem,
	statesText,
} from "@/lib/sms-settings-fields";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

function isDisclosureMode(value: string): value is SmsDisclosureMode {
	return SMS_DISCLOSURE_MODES.some((mode) => mode === value);
}

function isAmbiguousMode(value: string): value is SmsAmbiguousMode {
	return SMS_AMBIGUOUS_MODES.some((mode) => mode === value);
}

function Choice({
	label,
	value,
	disabled,
	options,
	onChange,
}: {
	label: string;
	value: string;
	disabled: boolean;
	options: { value: string; label: string; effect: string }[];
	onChange: (value: string) => void;
}) {
	const effect = options.find((option) => option.value === value)?.effect;

	return (
		<Field>
			<FieldLabel>{label}</FieldLabel>
			<ToggleGroup
				type="single"
				variant="outline"
				aria-label={label}
				value={value}
				disabled={disabled}
				className="flex-wrap justify-start"
				onValueChange={(next) => {
					if (next) onChange(next);
				}}
			>
				{options.map((option) => (
					<ToggleGroupItem key={option.value} value={option.value}>
						{option.label}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
			<FieldDescription>{effect}</FieldDescription>
		</Field>
	);
}

export function SmsSettingsForm() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const brandId = useId();
	const statesId = useId();
	const templateId = useId();
	const toneId = useId();

	const sms = useQuery(trpc.settings.sms.queryOptions());
	const workspace = useQuery(trpc.workspace.get.queryOptions());
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

	const brandError = brandProblem(draft.brandName);
	const statesError = statesProblem(states);
	const firstMessageError = firstMessageProblem(draft.firstMessageTemplate);
	const toneError = replyToneProblem(draft.replyTone);
	const next: SmsSettings = {
		...draft,
		licensedStates: parseStatesText(states),
	};
	const invalid =
		brandError !== null ||
		statesError !== null ||
		firstMessageError !== null ||
		toneError !== null;
	const unchanged = sameSmsSettings(next, sms.data.settings);
	const busy = save.isPending;

	return (
		<form
			className="flex flex-col gap-6"
			onSubmit={(event) => {
				event.preventDefault();
				const problem =
					brandError ?? statesError ?? firstMessageError ?? toneError;
				if (problem) {
					toast.error(problem);
					return;
				}
				save.mutate(next);
			}}
		>
			<Card>
				<CardHeader>
					<CardTitle>Your business</CardTitle>
					<CardDescription>
						Who the lead hears from, and where you may text.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<FieldGroup>
						<Field data-invalid={brandError !== null}>
							<FieldLabel htmlFor={brandId}>Business name</FieldLabel>
							<Input
								id={brandId}
								value={draft.brandName}
								disabled={busy}
								aria-invalid={brandError !== null}
								placeholder="Same as your workspace name"
								onChange={(event) =>
									setDraft({ ...draft, brandName: event.target.value })
								}
							/>
							<FieldDescription>
								Leads see this name. It must match the business name on your
								toll-free verification form. Leave it empty to use the workspace
								name.
							</FieldDescription>
							{brandError ? <FieldError>{brandError}</FieldError> : null}
						</Field>

						<Field data-invalid={statesError !== null}>
							<FieldLabel htmlFor={statesId}>Licensed states</FieldLabel>
							<Input
								id={statesId}
								value={states}
								disabled={busy}
								aria-invalid={statesError !== null}
								placeholder="TX, FL, GA"
								onChange={(event) => setStates(event.target.value)}
							/>
							{statesError === null && next.licensedStates.length > 0 ? (
								<ul
									className="flex flex-wrap gap-1"
									aria-label="Licensed states"
								>
									{next.licensedStates.map((code) => (
										<li key={code}>
											<Badge variant="token">{code}</Badge>
										</li>
									))}
								</ul>
							) : null}
							<FieldDescription>
								Only text leads in these states. Type two-letter codes separated
								by commas. Leave it empty to accept every state.
							</FieldDescription>
							{statesError ? <FieldError>{statesError}</FieldError> : null}
						</Field>
					</FieldGroup>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>First message</CardTitle>
					<CardDescription>
						The one text every new lead gets before they have answered.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<FieldGroup>
						<Field>
							<FieldLabel>What the lead gets</FieldLabel>
							<p
								className="rounded-md border bg-muted/40 px-3 py-2 text-sm"
								data-testid="first-message-preview"
							>
								{firstMessagePreview(draft, workspace.data?.name)}
							</p>
							<FieldDescription>
								This is the exact text. The name shown here is an example.
							</FieldDescription>
						</Field>

						<Field data-invalid={firstMessageError !== null}>
							<FieldLabel htmlFor={templateId}>Wording</FieldLabel>
							<Textarea
								id={templateId}
								value={draft.firstMessageTemplate}
								disabled={busy}
								rows={4}
								aria-invalid={firstMessageError !== null}
								onChange={(event) =>
									setDraft({
										...draft,
										firstMessageTemplate: event.target.value,
									})
								}
							/>
							<FieldDescription>
								Change the words as you like. Keep{" "}
								<code>{SMS_TEMPLATE_TOKENS.agency}</code>, which becomes your
								business name, and the line "Reply STOP to opt out." Use{" "}
								<code>{SMS_TEMPLATE_TOKENS.firstName}</code> for the lead's
								first name.
							</FieldDescription>
							{firstMessageError ? (
								<FieldError>{firstMessageError}</FieldError>
							) : null}
						</Field>
					</FieldGroup>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Replies</CardTitle>
					<CardDescription>
						How the assistant handles what leads write back.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<FieldGroup>
						<Field data-invalid={toneError !== null}>
							<FieldLabel htmlFor={toneId}>Reply tone</FieldLabel>
							<Textarea
								id={toneId}
								value={draft.replyTone}
								disabled={busy}
								rows={3}
								placeholder="Warm and brief. Plain words. No jargon."
								aria-invalid={toneError !== null}
								onChange={(event) =>
									setDraft({ ...draft, replyTone: event.target.value })
								}
							/>
							<FieldDescription>
								Tells the assistant how to word its replies. It changes the
								style only. It never changes what the assistant is allowed to
								say.
							</FieldDescription>
							{toneError ? <FieldError>{toneError}</FieldError> : null}
						</Field>

						<Choice
							label="Before a reply is sent"
							value={autoSendChoice(draft.autoSend)}
							disabled={busy}
							options={Object.entries(SMS_CHOICES.autoSend).map(
								([value, option]) => ({ value, ...option }),
							)}
							onChange={(value) =>
								setDraft({ ...draft, autoSend: value === "auto" })
							}
						/>

						<Choice
							label="When a reply is unclear"
							value={draft.ambiguousMode}
							disabled={busy}
							options={Object.entries(SMS_CHOICES.ambiguous).map(
								([value, option]) => ({ value, ...option }),
							)}
							onChange={(value) => {
								if (isAmbiguousMode(value)) {
									setDraft({ ...draft, ambiguousMode: value });
								}
							}}
						/>

						<Choice
							label="When a lead asks if they are talking to a bot"
							value={draft.disclosureMode}
							disabled={busy}
							options={Object.entries(SMS_CHOICES.disclosure).map(
								([value, option]) => ({ value, ...option }),
							)}
							onChange={(value) => {
								if (isDisclosureMode(value)) {
									setDraft({ ...draft, disclosureMode: value });
								}
							}}
						/>
					</FieldGroup>
				</CardContent>
			</Card>

			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-muted-foreground text-xs">
					Only an owner or an admin can save these settings.
				</p>
				<Button type="submit" disabled={busy || unchanged || invalid}>
					{busy ? <Spinner data-icon="inline-start" /> : null}
					Save texting settings
				</Button>
			</div>
		</form>
	);
}
