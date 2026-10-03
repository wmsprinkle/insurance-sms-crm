import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { TrpcModule } from "../trpc/trpc.module";
import { LeadImportService } from "./lead-import.service";
import { LeadWriterService } from "./lead-writer.service";
import { LeadsRouter } from "./leads.router";

@Module({
	imports: [TrpcModule, AgentModule],
	providers: [LeadWriterService, LeadImportService, LeadsRouter],
})
export class LeadsModule {}
