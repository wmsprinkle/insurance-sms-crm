import { Module } from "@nestjs/common";
import { ComplianceAdminService } from "./compliance-admin.service";
import { ConsentService } from "./consent.service";
import { SendGateService } from "./send-gate";
import { SuppressionService } from "./suppression.service";

@Module({
	providers: [
		ConsentService,
		SuppressionService,
		SendGateService,
		ComplianceAdminService,
	],
	exports: [
		ConsentService,
		SuppressionService,
		SendGateService,
		ComplianceAdminService,
	],
})
export class ComplianceModule {}
