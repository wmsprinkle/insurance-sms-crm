import { Module } from "@nestjs/common";
import { ConsentService } from "./consent.service";
import { SendGateService } from "./send-gate";
import { SuppressionService } from "./suppression.service";

@Module({
	providers: [ConsentService, SuppressionService, SendGateService],
	exports: [ConsentService, SuppressionService, SendGateService],
})
export class ComplianceModule {}
