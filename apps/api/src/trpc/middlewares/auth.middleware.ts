import { workspaceRoleOf } from "@crm/auth";
import { Injectable, Logger } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";
import { setRequestUserId } from "../../logging/request-context";
import type { AuthedTrpcContext, BaseTrpcContext } from "../context.types";
import { requiredRoleOf, roleMeets } from "../procedure-roles";

@Injectable()
export class AuthMiddleware implements TRPCMiddleware {
	private readonly logger = new Logger(AuthMiddleware.name);

	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const ctx = opts.ctx as BaseTrpcContext;
		const user = ctx.session?.user;

		if (!user) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}

		setRequestUserId(user.id);

		if (opts.type === "mutation") await this.requireRole(opts.path, user.id);

		const nextCtx: AuthedTrpcContext = { ...ctx, user };
		return opts.next({ ctx: nextCtx });
	}

	private async requireRole(path: string, userId: string): Promise<void> {
		const required = requiredRoleOf(path);
		if (!required) {
			this.logger.error({ message: "Mutation has no role class", path });
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "This action has no role rule, so it is refused.",
			});
		}

		if (roleMeets(await workspaceRoleOf(userId), required)) return;

		this.logger.warn({ message: "Mutation refused for role", path, required });
		throw new TRPCError({
			code: "FORBIDDEN",
			message:
				required === "owner"
					? "Only an owner can do this."
					: "Only an owner or an admin can do this.",
		});
	}
}
