import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { TodayRouter } from "./today.router";
import { TodayService } from "./today.service";

@Module({
	imports: [TrpcModule],
	providers: [TodayService, TodayRouter],
})
export class TodayModule {}
