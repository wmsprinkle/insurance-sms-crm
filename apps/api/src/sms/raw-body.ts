import type { IncomingMessage } from "node:http";

type RequestWithRawBody = IncomingMessage & { rawBody?: Buffer };

export function readRawBody(
	request: IncomingMessage,
	limit: number,
): Promise<Buffer | null> {
	const captured = (request as RequestWithRawBody).rawBody;
	if (Buffer.isBuffer(captured)) {
		return Promise.resolve(captured.length > limit ? null : captured);
	}
	if (request.readableEnded) return Promise.resolve(null);
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let settled = false;

		const finish = (value: Buffer | null) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		request.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > limit) {
				request.destroy();
				finish(null);
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => finish(Buffer.concat(chunks)));
		request.on("error", () => finish(null));
		request.on("aborted", () => finish(null));
		request.on("close", () => finish(null));
	});
}
