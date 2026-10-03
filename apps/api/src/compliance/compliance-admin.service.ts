import { randomUUID } from "node:crypto";
import {
	canImportLeads,
	canManageCompliance,
	canSendSms,
	type WorkspaceRole,
	workspaceRoleOf,
} from "@crm/auth";
import type { Db, Prisma } from "@crm/db";
import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { COMPLIANCE } from "./compliance-config";

const COMPLIANCE_ACTIONS = {
	complianceSettings: {
		allowed: canManageCompliance,
		refusal:
			"Only an owner or an admin can change SMS compliance or retention settings.",
	},
	leadImport: {
		allowed: canImportLeads,
		refusal: "Only an owner or an admin can import leads.",
	},
	bulkDrafts: {
		allowed: canManageCompliance,
		refusal: "Only an owner or an admin can send or discard drafts in bulk.",
	},
	smsSend: {
		allowed: canSendSms,
		refusal: "Only a workspace member can send or approve texts.",
	},
} as const satisfies Record<
	string,
	{ allowed: (role: WorkspaceRole | null) => boolean; refusal: string }
>;

export type ComplianceAction = keyof typeof COMPLIANCE_ACTIONS;

type AuditType = Exclude<keyof typeof COMPLIANCE.adminAudit, "sessionId">;

@Injectable()
export class ComplianceAdminService {
	private readonly logger = new Logger(ComplianceAdminService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async require(userId: string, action: ComplianceAction): Promise<void> {
		const role = await workspaceRoleOf(userId, this.db);
		const rule = COMPLIANCE_ACTIONS[action];
		if (rule.allowed(role)) return;

		this.logger.warn({ message: "Compliance action refused", userId, action });
		throw new ForbiddenException(rule.refusal);
	}

	async record(
		userId: string,
		type: AuditType,
		data: Prisma.InputJsonObject,
	): Promise<void> {
		await this.db.agentEvent.create({
			data: {
				id: randomUUID(),
				sessionId: COMPLIANCE.adminAudit.sessionId,
				contactId: null,
				type: COMPLIANCE.adminAudit[type],
				data: { userId, ...data },
				emittedAt: new Date(),
			},
		});
	}
}
