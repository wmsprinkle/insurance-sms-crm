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
import {
	type CalendarSettings,
	calendarSettings,
} from "@crm/validation/calendar-settings";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { CALENDAR_OWNER_AUTO, ownerOptionValue } from "@/lib/calendar-settings";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

export function CalendarSettingsForm() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const ownerId = useId();
	const linkId = useId();

	const calendar = useQuery(trpc.settings.calendar.queryOptions());
	const [owner, setOwner] = useState<string>(CALENDAR_OWNER_AUTO);
	const [link, setLink] = useState("");

	useEffect(() => {
		if (!calendar.data) return;
		setOwner(ownerOptionValue(calendar.data.settings.ownerUserId));
		setLink(calendar.data.settings.fallbackBookingLink ?? "");
	}, [calendar.data]);

	const save = useMutation(
		trpc.settings.setCalendar.mutationOptions({
			onSuccess: async () => {
				await cache.settings();
				toast.success("Booking settings saved.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!calendar.data) return null;

	const next: CalendarSettings = {
		ownerUserId: owner === CALENDAR_OWNER_AUTO ? null : owner,
		fallbackBookingLink: link.trim() === "" ? null : link.trim(),
	};
	const check = calendarSettings.safeParse(next);
	const linkError = check.success
		? null
		: "Enter a full link that starts with http:// or https://.";
	const saved = calendar.data.settings;
	const unchanged =
		next.ownerUserId === saved.ownerUserId &&
		next.fallbackBookingLink === saved.fallbackBookingLink;
	const accounts = calendar.data.accounts;
	const effective = accounts.find(
		(person) => person.userId === calendar.data.effectiveOwnerUserId,
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Booking</CardTitle>
				<CardDescription>
					Whose Google calendar the agent books calls on, and the link it sends
					when the calendar is unavailable.
				</CardDescription>
				<CardAction>
					<Button
						type="submit"
						form="calendar-settings"
						disabled={save.isPending || unchanged || linkError !== null}
					>
						{save.isPending ? <Spinner data-icon="inline-start" /> : null}
						Save
					</Button>
				</CardAction>
			</CardHeader>

			<CardContent>
				<form
					id="calendar-settings"
					onSubmit={(event) => {
						event.preventDefault();
						if (linkError) {
							toast.error(linkError);
							return;
						}
						save.mutate(next);
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor={ownerId}>Calendar owner</FieldLabel>
							<Select
								value={owner}
								disabled={save.isPending || accounts.length === 0}
								onValueChange={setOwner}
							>
								<SelectTrigger id={ownerId} className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={CALENDAR_OWNER_AUTO}>
										First connected Google account
									</SelectItem>
									{accounts.map((person) => (
										<SelectItem key={person.userId} value={person.userId}>
											{person.name} ({person.email})
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<FieldDescription>
								{accounts.length === 0
									? "No one has connected Google yet. Connect an account in Settings, then Connections."
									: `Booked calls go on ${effective ? `${effective.name}'s` : "this person's"} calendar. Only people who connected Google can be picked.`}
							</FieldDescription>
						</Field>

						<Field data-invalid={linkError !== null}>
							<FieldLabel htmlFor={linkId}>Fallback booking link</FieldLabel>
							<Input
								id={linkId}
								type="url"
								value={link}
								disabled={save.isPending}
								aria-invalid={linkError !== null}
								placeholder="https://cal.example.com/your-agency"
								onChange={(event) => setLink(event.target.value)}
							/>
							<FieldDescription>
								The agent sends this link only when it cannot read the calendar.
								Leave it empty to hand the lead to a person instead.
							</FieldDescription>
							{linkError ? <FieldError>{linkError}</FieldError> : null}
						</Field>
					</FieldGroup>
				</form>
			</CardContent>
		</Card>
	);
}
