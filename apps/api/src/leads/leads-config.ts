const KIB = 1_024;
const MIB = 1_024 * KIB;
const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;

export const LEADS = {
	csv: {
		maxBytes: 5 * MIB,
		maxRows: 5_000,
		maxColumns: 100,
	},
	ingest: {
		maxBodyBytes: 32 * KIB,
		signatureToleranceMs: 5 * MINUTE_MS,
		minSecretLength: 16,
	},
	consent: {
		clockSkewMs: 5 * MINUTE_MS,
	},
	field: {
		maxLength: 500,
		maxOptInTextLength: 2_000,
	},
	firstTouch: {
		reason: "First touch for a new lead",
		priority: 50,
		budget: 4,
	},
} as const;

export const LEAD_INGEST_HEADERS = {
	source: "x-lead-source",
	timestamp: "x-lead-timestamp",
	signature: "x-lead-signature",
} as const;
