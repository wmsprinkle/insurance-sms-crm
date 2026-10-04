import { createServer, request } from "node:http";
import { pathToFileURL } from "node:url";
import { PUBLIC } from "./public-config.mjs";

const NOT_FOUND = "not found";

export function routeFor(rawUrl, config = PUBLIC) {
	let pathname;

	if (!/^\/(?!\/)/.test(rawUrl)) return "blocked";

	try {
		pathname = new URL(rawUrl, "http://edge.invalid").pathname.toLowerCase();
	} catch {
		return "blocked";
	}

	if (
		pathname.includes("%") ||
		pathname.includes("\\") ||
		config.blockedPrefixes.some(
			(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
		) ||
		config.blockedFragments.some((fragment) => pathname.includes(fragment))
	) {
		return "blocked";
	}

	return config.apiPaths.includes(pathname) ? "api" : "app";
}

export function createEdgeProxy(config = PUBLIC) {
	return createServer((incoming, outgoing) => {
		const target = routeFor(incoming.url ?? "/", config);

		if (target === "blocked") {
			outgoing.writeHead(404, { "content-type": "text/plain" });
			outgoing.end(NOT_FOUND);
			return;
		}

		const upstream = config.upstreams[target];

		const forward = request(
			{
				host: upstream.host,
				port: upstream.port,
				method: incoming.method,
				path: incoming.url,
				headers: incoming.headers,
				timeout: config.edge.upstreamTimeoutMs,
			},
			(response) => {
				outgoing.writeHead(
					response.statusCode ?? 502,
					response.statusMessage,
					response.rawHeaders,
				);
				response.pipe(outgoing);
			},
		);

		forward.on("timeout", () => forward.destroy());

		forward.on("error", () => {
			if (outgoing.headersSent) {
				outgoing.destroy();
				return;
			}
			outgoing.writeHead(502, { "content-type": "text/plain" });
			outgoing.end("bad gateway");
		});

		incoming.on("aborted", () => forward.destroy());
		incoming.pipe(forward);
	});
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const { host, port } = PUBLIC.edge;
	createEdgeProxy().listen(port, host, () => {
		console.log(`edge proxy on http://${host}:${port}`);
	});
}
