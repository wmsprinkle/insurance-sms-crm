import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { TrpcModule } from "../trpc/trpc.module";
import { LeadImportService } from "./lead-import.service";
import { LeadIngestController } from "./lead-ingest.controller";
import { LeadIngestService } from "./lead-ingest.service";
import { LeadWriterService } from "./lead-writer.service";
import { LeadsRouter } from "./leads.router";

@Module({
	imports: [TrpcModule, AgentModule],
	controllers: [LeadIngestController],
	providers: [
		LeadWriterService,
		LeadImportService,
		LeadIngestService,
		LeadsRouter,
	],
})
export class LeadsModule {}
