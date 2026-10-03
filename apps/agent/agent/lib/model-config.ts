export const ANTHROPIC = {
	defaultModelId: "claude-haiku-4-5-20251001",
	defaultContextWindowTokens: 200_000,
	gatewayPrefix: "anthropic/",
	workspaceHeader: "anthropic-workspace-id",
	keyVariable: "ANTHROPIC_API_KEY",
	workspaceVariable: "ANTHROPIC_WORKSPACE_ID",
} as const;
