import { pathToFileURL } from "node:url";
import { PUBLIC } from "./public-config.mjs";

const MINUTE_MS = 60 * 1000;

function fieldMatches(field, value) {
	if (field === "*") return true;
	if (field.startsWith("*/")) return value % Number(field.slice(2)) === 0;
	return Number(field) === value;
}

export function dueJobs(date, jobs = PUBLIC.cron.jobs) {
	const minute = date.getUTCMinutes();
	const hour = date.getUTCHours();

	return jobs.filter(
		(job) => fieldMatches(job.minute, minute) && fieldMatches(job.hour, hour),
	);
}

async function fire(job, secret) {
	const { host, port } = PUBLIC.upstreams.api;

	try {
		const response = await fetch(`http://${host}:${port}${job.path}`, {
			method: "POST",
			headers: { authorization: `Bearer ${secret}` },
			signal: AbortSignal.timeout(PUBLIC.cron.timeoutMs),
		});
		console.log(`${new Date().toISOString()} ${job.path} ${response.status}`);
	} catch (cause) {
		console.log(`${new Date().toISOString()} ${job.path} failed ${cause}`);
	}
}

async function main() {
	const secret = process.env.CRON_SECRET;

	if (!secret) {
		console.error("CRON_SECRET is not set.");
		process.exit(1);
	}

	for (;;) {
		await new Promise((resolve) =>
			setTimeout(resolve, MINUTE_MS - (Date.now() % MINUTE_MS) + 250),
		);
		await Promise.all(dueJobs(new Date()).map((job) => fire(job, secret)));
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	await main();
}
