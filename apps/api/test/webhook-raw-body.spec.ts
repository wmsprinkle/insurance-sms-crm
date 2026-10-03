import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
	nowSeconds,
	signTelnyx,
	telnyxBody,
	testKeys,
} from "./support/sms-fakes";

const keys = testKeys();

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

function post(
	app: NestExpressApplication,
	path: string,
	headers: Record<string, string>,
	body: string,
): Promise<{ status: number }> {
	const socket = new Socket();
	socket.write = ((...args: unknown[]) => {
		const done = args.find((arg) => typeof arg === "function") as
			| (() => void)
			| undefined;
		done?.();
		return true;
	}) as typeof socket.write;
	const req = new IncomingMessage(socket);
	req.method = "POST";
	req.url = path;
	req.headers = {
		...headers,
		"content-length": String(Buffer.byteLength(body)),
	};
	req.push(Buffer.from(body));
	req.push(null);
	const res = new ServerResponse(req);
	res.assignSocket(socket);
	const handler = app.getHttpAdapter().getInstance() as Handler;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("request hung: body stream never ended")),
			5_000,
		);
		const end = res.end.bind(res) as (...args: unknown[]) => ServerResponse;
		res.end = ((...args: unknown[]) => {
			clearTimeout(timer);
			resolve({ status: res.statusCode });
			return end(...args);
		}) as typeof res.end;
		handler(req, res);
	});
}

const fallback = (key: string, value: string) => {
	if (!process.env[key]) {
		process.env[key] = value;
	}
};

fallback(
	"DATABASE_URL",
	"postgresql://postgres:postgres@localhost:5432/crm?schema=public",
);
fallback("BETTER_AUTH_SECRET", "test-secret-at-least-32-characters-long");
fallback("API_URL", "http://localhost:3001");
fallback("ALLOWED_SIGN_IN", "dev@example.com");
fallback("GOOGLE_CLIENT_ID", "test-google-client-id");
fallback("GOOGLE_CLIENT_SECRET", "test-google-client-secret");
process.env.TELNYX_PUBLIC_KEY = keys.publicKeyBase64;

describe("Telnyx webhook through createApp", () => {
	let app: NestExpressApplication;

	beforeAll(async () => {
		const { createApp } = await import("../src/create-app");
		app = await createApp();
	});

	afterAll(async () => {
		await app.close();
	});

	it("accepts an application/json body with a valid signature", async () => {
		const body = telnyxBody({ eventType: "message.unknown" });
		const timestamp = nowSeconds();
		const response = await post(
			app,
			"/webhooks/telnyx",
			{
				"content-type": "application/json",
				"telnyx-timestamp": timestamp,
				"telnyx-signature-ed25519": signTelnyx(
					keys.privateKey,
					timestamp,
					body,
				),
			},
			body,
		);

		expect(response.status).toBe(200);
	});

	it("rejects an application/json body with a wrong signature", async () => {
		const body = telnyxBody({ eventType: "message.unknown" });
		const timestamp = nowSeconds();
		const response = await post(
			app,
			"/webhooks/telnyx",
			{
				"content-type": "application/json",
				"telnyx-timestamp": timestamp,
				"telnyx-signature-ed25519": signTelnyx(
					keys.privateKey,
					timestamp,
					`${body} `,
				),
			},
			body,
		);

		expect(response.status).toBe(401);
	});
});
