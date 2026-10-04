const SECOND_MS = 1000;

export const PUBLIC = {
	edge: {
		host: "127.0.0.1",
		port: 8080,
		upstreamTimeoutMs: 120 * SECOND_MS,
	},
	upstreams: {
		app: { host: "127.0.0.1", port: 3000 },
		api: { host: "127.0.0.1", port: 3001 },
	},
	apiPaths: ["/webhooks/telnyx", "/leads/ingest"],
	blockedPrefixes: ["/internal"],
	blockedFragments: ["dev-login"],
	cron: {
		timeoutMs: 60 * SECOND_MS,
		jobs: [
			{ path: "/internal/sync/mailboxes", minute: "*/5", hour: "*" },
			{ path: "/internal/sync/rates", minute: "0", hour: "6" },
			{ path: "/internal/telemetry/rollup", minute: "0", hour: "7" },
			{ path: "/internal/tracking/retention", minute: "0", hour: "4" },
			{ path: "/internal/archive/prune", minute: "0", hour: "5" },
		],
	},
};
