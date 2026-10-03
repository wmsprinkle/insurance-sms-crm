// Insurance SMS CRM: upstream features that stay in the code but are off
// unless an install opts in. The only value that turns one on is "true".
export const FEATURES = {
	enrichment: "FEATURE_ENRICHMENT",
	slack: "FEATURE_SLACK",
	tracking: "FEATURE_TRACKING",
} as const;

export type Feature = keyof typeof FEATURES;

export function featureEnabled(feature: Feature): boolean {
	return process.env[FEATURES[feature]]?.trim() === "true";
}
