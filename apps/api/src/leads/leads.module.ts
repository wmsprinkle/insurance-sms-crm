import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { ComplianceModule } from "../compliance/compliance.module";
import { TrpcModule } from "../trpc/trpc.module";
import { FirstTouchService } from "./first-touch.service";
import { LeadImportService } from "./lead-import.service";
import { LeadIngestController } from "./lead-ingest.controller";
import { LeadIngestService } from "./lead-ingest.service";
import { LeadWriterService } from "./lead-writer.service";
import { LeadsRouter } from "./leads.router";

@Module({
	imports: [TrpcModule, AgentModule, ComplianceModule],
	controllers: [LeadIngestController],
	providers: [
		FirstTouchService,
		LeadWriterService,
		LeadImportService,
		LeadIngestService,
		LeadsRouter,
	],
})
export class LeadsModule {}
