import type { IncomingMessage } from "node:http";

export function readRawBody(
	request: IncomingMessage,
	limit: number,
): Promise<Buffer | null> {
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
	});
}
