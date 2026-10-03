import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import { SETTINGS_ID } from "@crm/db/settings";
import { readSmsEnv } from "@crm/env/sms";
import { buildFirstMessage } from "@crm/validation/sms-first-message";
import { parseSmsSettings } from "@crm/validation/sms-settings";
import {
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { SIMULATE, simulatedInbound, simulateSummary } from "./simulate";
import type {
	SmsSendTestFirstMessageInput,
	SmsSendTestFirstMessageOutput,
	SmsSimulateInboundInput,
	SmsSimulateInboundOutput,
} from "./simulate.contracts";
import { SmsService } from "./sms.service";
import { readBrand } from "./sms-brand";
import { SmsInternalService } from "./sms-internal.service";

type Recipient = { id: string; firstName: string; phone: string };

@Injectable()
export class SmsSimulateService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(SmsService) private readonly sms: SmsService,
		@Inject(SmsInternalService) private readonly internal: SmsInternalService,
	) {}

	async simulateInbound(
		input: SmsSimulateInboundInput,
	): Promise<SmsSimulateInboundOutput> {
		this.requireDryRun();
		const contact = await this.recipient(input.contactId);
		const outcome = await this.sms.receive(
			simulatedInbound({
				from: contact.phone,
				to: readSmsEnv().fromNumber,
				text: input.body,
				id: randomUUID(),
			}),
		);
		return { outcome, summary: simulateSummary(outcome) };
	}

	async sendTestFirstMessage(
		input: SmsSendTestFirstMessageInput,
	): Promise<SmsSendTestFirstMessageOutput> {
		this.requireDryRun();
		const contact = await this.recipient(input.contactId);
		const text = await this.firstMessage(contact.firstName);
		const response = await this.internal.send({
			contactId: contact.id,
			to: contact.phone,
			text,
			purpose: "first-touch",
			idempotencyKey: `${SIMULATE.firstMessageKeyPrefix}${randomUUID()}`,
			taskId: null,
			dryRun: true,
		});

		switch (response.status) {
			case "sent":
				return {
					status: "sent",
					summary: "The first message was recorded. Nothing was really sent.",
					text,
				};
			case "blocked":
				return {
					status: "blocked",
					summary: `The send gate blocked it: ${response.reason}.`,
					text,
				};
			case "failed":
				return { status: "failed", summary: response.error, text };
		}
	}

	private requireDryRun(): void {
		if (!readSmsEnv().dryRun) throw new ForbiddenException(SIMULATE.refusal);
	}

	private async recipient(contactId: string): Promise<Recipient> {
		const contact = await this.db.contact.findFirst({
			where: { id: contactId, archivedAt: null },
			select: { id: true, firstName: true, phone: true },
		});
		if (!contact?.phone) {
			throw new NotFoundException("That lead does not exist or has no phone.");
		}
		return {
			id: contact.id,
			firstName: contact.firstName,
			phone: contact.phone,
		};
	}

	private async firstMessage(firstName: string): Promise<string> {
		const [row, brand] = await Promise.all([
			this.db.appSetting.findUnique({
				where: { id: SETTINGS_ID },
				select: { sms: true },
			}),
			readBrand(this.db),
		]);
		const settings = parseSmsSettings(row?.sms ?? null);
		return buildFirstMessage({
			firstName,
			brand,
			brandPrefix: settings.firstMessageBrandPrefix,
			stopFooter: settings.firstMessageStopFooter,
		});
	}
}
