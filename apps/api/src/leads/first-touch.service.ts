import type { Prisma, RecordSource } from "@crm/db";
import { lockIdempotencyKey } from "@crm/db/idempotency";
import { SETTINGS_ID } from "@crm/db/settings";
import { WORKSPACE_ID } from "@crm/db/workspace";
import {
	FIRST_TOUCH_TASK_KIND,
	type FirstTouchTaskPayload,
} from "@crm/validation/first-touch-task";
import {
	parseSmsSettings,
	renderFirstMessage,
} from "@crm/validation/sms-settings";
import { Injectable, Logger } from "@nestjs/common";
import { ConsentService } from "../compliance/consent.service";
import { nextSendWindow, sendWindowFor } from "../compliance/quiet-hours";
import { SuppressionService } from "../compliance/suppression.service";
import { type FirstTouchPlan, planFirstTouch } from "./first-touch";
import { LEADS } from "./leads-config";

export type FirstTouchLead = {
	contactId: string;
	phone: string;
	firstName: string | null;
	origin: RecordSource;
};

@Injectable()
export class FirstTouchService {
	private readonly logger = new Logger(FirstTouchService.name);

	constructor(
		private readonly consent: ConsentService,
		private readonly suppression: SuppressionService,
	) {}

	async enqueue(
		tx: Prisma.TransactionClient,
		lead: FirstTouchLead,
		now: Date = new Date(),
	): Promise<FirstTouchPlan> {
		await lockIdempotencyKey(
			tx,
			`agent-task:${FIRST_TOUCH_TASK_KIND}:${lead.contactId}`,
		);

		const [existing, suppressed, consent] = await Promise.all([
			tx.agentTask.findFirst({
				where: { kind: FIRST_TOUCH_TASK_KIND, contactId: lead.contactId },
				select: { id: true },
			}),
			this.suppression.isSuppressed(lead.phone, tx),
			this.consent.hasActiveConsent(lead.contactId, tx),
		]);

		const plan = planFirstTouch({
			alreadyQueued: existing !== null,
			suppressed,
			consent,
			dueAt: nextSendWindow(now, sendWindowFor({ e164: lead.phone })),
		});

		if (!plan.queue) {
			this.logger.log({
				message: "First touch not queued",
				contactId: lead.contactId,
				reason: plan.reason,
			});
			return plan;
		}

		const payload: FirstTouchTaskPayload = {
			type: "lead.created",
			to: lead.phone,
			message: await this.message(tx, lead.firstName),
			origin: lead.origin,
		};
		const { reason, priority, budget } = LEADS.firstTouch;
		await tx.agentTask.create({
			data: {
				contactId: lead.contactId,
				kind: FIRST_TOUCH_TASK_KIND,
				reason,
				priority,
				budget,
				dueAt: plan.dueAt,
				payload,
			},
		});

		this.logger.log({
			message: "First touch queued",
			contactId: lead.contactId,
			dueAt: plan.dueAt.toISOString(),
		});
		return plan;
	}

	private async message(
		tx: Prisma.TransactionClient,
		firstName: string | null,
	): Promise<string> {
		const [settings, workspace] = await Promise.all([
			tx.appSetting.findUnique({
				where: { id: SETTINGS_ID },
				select: { sms: true },
			}),
			tx.organization.findUnique({
				where: { id: WORKSPACE_ID },
				select: { name: true },
			}),
		]);
		const { firstMessageTemplate } = parseSmsSettings(settings?.sms ?? null);
		return renderFirstMessage(firstMessageTemplate, {
			firstName,
			agency: workspace?.name?.trim() || LEADS.firstTouch.agencyFallback,
		});
	}
}
