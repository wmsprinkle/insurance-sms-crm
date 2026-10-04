import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, request } from "node:http";
import { createEdgeProxy, routeFor } from "./edge-proxy.mjs";
import { dueJobs } from "./local-cron.mjs";

describe("routeFor", () => {
	test("sends webhook and ingest paths to the api", () => {
		expect(routeFor("/webhooks/telnyx")).toBe("api");
		expect(routeFor("/webhooks/telnyx?x=1")).toBe("api");
		expect(routeFor("/leads/ingest")).toBe("api");
	});

	test("sends everything else to the app", () => {
		expect(routeFor("/")).toBe("app");
		expect(routeFor("/api/auth/callback/google")).toBe("app");
		expect(routeFor("/webhooks/telnyx/extra")).toBe("app");
	});

	test("blocks internal paths and encoded tricks", () => {
		expect(routeFor("/internal/sync/mailboxes")).toBe("blocked");
		expect(routeFor("/INTERNAL/sync/rates")).toBe("blocked");
		expect(routeFor("/%69nternal/sync/rates")).toBe("blocked");
		expect(routeFor("/internal")).toBe("blocked");
	});

	test("blocks the dev-login endpoint in every spelling", () => {
		for (const path of [
			"/api/auth/dev-login",
			"/api/auth/dev-login?x=1",
			"/api/auth/dev-login/",
			"/API/Auth/Dev-Login",
			"/api/auth/%64ev-login",
			"/api/auth/dev-login%2f",
			"/dev-login",
			"//api/auth/dev-login",
			"//evil.example/api/auth/dev-login",
		]) {
			expect(routeFor(path)).toBe("blocked");
		}
	});

	test("blocks request targets that are not an origin-form path", () => {
		for (const path of ["", "api", "http://evil.example/", "*"]) {
			expect(routeFor(path)).toBe("blocked");
		}
	});
});

describe("dueJobs", () => {
	const at = (iso) => dueJobs(new Date(iso)).map((job) => job.path);

	test("runs mailbox sync every five minutes", () => {
		expect(at("2026-10-04T10:05:00Z")).toEqual(["/internal/sync/mailboxes"]);
		expect(at("2026-10-04T10:06:00Z")).toEqual([]);
	});

	test("runs daily jobs on their hour", () => {
		expect(at("2026-10-04T06:00:00Z")).toContain("/internal/sync/rates");
		expect(at("2026-10-04T07:00:00Z")).toContain("/internal/telemetry/rollup");
		expect(at("2026-10-04T04:00:00Z")).toContain(
			"/internal/tracking/retention",
		);
		expect(at("2026-10-04T05:00:00Z")).toContain("/internal/archive/prune");
		expect(at("2026-10-04T05:31:00Z")).toEqual([]);
	});
});

function listen(server) {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve(server.address().port));
	});
}

const canListen = await listen(createServer())
	.then(() => true)
	.catch(() => false);

function send(port, path, body) {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: "127.0.0.1",
				port,
				path,
				method: "POST",
				headers: { "x-custom": "kept", "content-type": "application/json" },
			},
			(res) => {
				const chunks = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () =>
					resolve({
						status: res.statusCode,
						text: Buffer.concat(chunks).toString(),
					}),
				);
			},
		);
		req.on("error", reject);
		req.end(body);
	});
}

describe.skipIf(!canListen)("edge proxy", () => {
	const servers = [];
	let edgePort;

	beforeAll(async () => {
		const echo = (name) =>
			createServer((req, res) => {
				const chunks = [];
				req.on("data", (chunk) => chunks.push(chunk));
				req.on("end", () => {
					res.setHeader("x-upstream", name);
					res.end(
						JSON.stringify({
							path: req.url,
							custom: req.headers["x-custom"],
							body: Buffer.concat(chunks).toString("base64"),
						}),
					);
				});
			});
		const app = echo("app");
		const api = echo("api");
		const appPort = await listen(app);
		const apiPort = await listen(api);
		const edge = createEdgeProxy({
			edge: { upstreamTimeoutMs: 5000 },
			upstreams: {
				app: { host: "127.0.0.1", port: appPort },
				api: { host: "127.0.0.1", port: apiPort },
			},
			apiPaths: ["/webhooks/telnyx", "/leads/ingest"],
			blockedPrefixes: ["/internal"],
			blockedFragments: ["dev-login"],
		});
		edgePort = await listen(edge);
		servers.push(app, api, edge);
	});

	afterAll(() => {
		for (const server of servers) server.close();
	});

	test("forwards the raw body byte for byte to the api", async () => {
		const raw = Buffer.from('{"a": 1,  "b":\n"é"}  ');
		const result = await send(edgePort, "/webhooks/telnyx", raw);
		const echoed = JSON.parse(result.text);
		expect(Buffer.from(echoed.body, "base64").equals(raw)).toBe(true);
		expect(echoed.custom).toBe("kept");
	});

	test("routes other paths to the app and blocks internal", async () => {
		const toApp = await send(edgePort, "/sign-in?x=1", "hi");
		expect(JSON.parse(toApp.text).path).toBe("/sign-in?x=1");
		const blocked = await send(edgePort, "/internal/sync/mailboxes", "");
		expect(blocked.status).toBe(404);
	});

	test("refuses the dev-login endpoint and never reaches the app", async () => {
		const result = await send(edgePort, "/api/auth/dev-login", "{}");
		expect(result.status).toBe(404);
		expect(result.text).toBe("not found");
	});
});
