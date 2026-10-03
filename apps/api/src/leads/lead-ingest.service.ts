import { RecordSource } from "@crm/db/enums";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { checkRows, type LeadRowResult } from "./lead-batch";
import { LeadWriterService } from "./lead-writer.service";
import type { LeadIngestBody } from "./leads.contracts";

@Injectable()
export class LeadIngestService {
	private readonly logger = new Logger(LeadIngestService.name);

	constructor(
		@Inject(LeadWriterService) private readonly writer: LeadWriterService,
	) {}

	async accept(source: string, body: LeadIngestBody): Promise<LeadRowResult> {
		const checked = checkRows([
			{
				rowNumber: 1,
				raw: {
					firstName: body.firstName,
					lastName: body.lastName,
					fullName: body.fullName,
					email: body.email,
					phone: body.phone,
					consentSource: body.consent.source,
					consentCapturedAt: body.consent.capturedAt,
					optInText: body.consent.optInText,
					optInUrl: body.consent.optInUrl,
					consentIp: body.consent.ip,
				},
			},
		]);

		const outcome = await this.writer.triage(checked);
		const [result] = await this.writer.write(outcome, RecordSource.LEAD_IMPORT);
		if (!result) throw new Error("Lead ingest produced no result.");

		this.logger.log({
			message: "Lead ingested",
			source,
			status: result.status,
			reasons: result.reasons,
			contactId: result.contactId,
		});

		return result;
	}
}
