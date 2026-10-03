import { describe, expect, it } from "bun:test";
import type { SmsEnv } from "@crm/env/sms";
import { type Clock, RateLimiter, TokenBucket } from "../src/sms/rate-limiter";
import {
	type Fetcher,
	TelnyxClient,
	TelnyxSendError,
} from "../src/sms/telnyx.client";

function fakeClock(start = 0): Clock & { slept: number[] } {
	let now = start;
	const slept: number[] = [];
	return {
		slept,
		now: () => now,
		sleep: async (ms) => {
			slept.push(ms);
			now += ms;
		},
	};
}

const liveEnv: SmsEnv = {
	apiKey: "test-key",
	publicKey: null,
	messagingProfileId: "profile-1",
	fromNumber: "+18005550100",
	messagesPerSecond: null,
	dryRun: false,
};

function recordingFetcher(
	status: number,
	body: unknown,
): { fetcher: Fetcher; calls: { url: string; init: RequestInit }[] } {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetcher = (async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		return new Response(JSON.stringify(body), { status });
	}) as unknown as Fetcher;
	return { fetcher, calls };
}

describe("TokenBucket", () => {
	it("allows the burst at once and spaces the rest by the rate", () => {
		const bucket = new TokenBucket(2, 2, 0);
		expect(bucket.reserve(0)).toBe(0);
		expect(bucket.reserve(0)).toBe(0);
		expect(bucket.reserve(0)).toBe(500);
		expect(bucket.reserve(0)).toBe(1000);
	});

	it("refills over time up to capacity", () => {
		const bucket = new TokenBucket(1, 1, 0);
		expect(bucket.reserve(0)).toBe(0);
		expect(bucket.reserve(10_000)).toBe(0);
		expect(bucket.reserve(10_000)).toBe(1000);
	});
});

describe("RateLimiter", () => {
	it("keeps one bucket per sending number", async () => {
		const clock = fakeClock();
		const limiter = new RateLimiter(1, 1, clock);
		expect(await limiter.acquire("+18005550100")).toBe(0);
		expect(await limiter.acquire("+18005550101")).toBe(0);
		expect(await limiter.acquire("+18005550100")).toBe(1000);
		expect(clock.slept).toEqual([1000]);
	});
});

describe("TelnyxClient", () => {
	it("fakes an id and never calls Telnyx in dry run", async () => {
		const { fetcher, calls } = recordingFetcher(200, {});
		const client = new TelnyxClient(
			{ ...liveEnv, dryRun: true },
			new RateLimiter(10, 10, fakeClock()),
			fetcher,
		);

		const result = await client.send({ to: "+15125550123", text: "Hi" });

		expect(result.dryRun).toBe(true);
		expect(result.id.startsWith("dryrun-")).toBe(true);
		expect(calls).toHaveLength(0);
	});

	it("posts the message with the profile and returns Telnyx's id", async () => {
		const { fetcher, calls } = recordingFetcher(200, {
			data: { id: "msg-123" },
		});
		const client = new TelnyxClient(
			liveEnv,
			new RateLimiter(10, 10, fakeClock()),
			fetcher,
		);

		const result = await client.send({ to: "+15125550123", text: "Hi" });

		expect(result).toEqual({
			id: "msg-123",
			from: "+18005550100",
			dryRun: false,
		});
		expect(calls[0]?.url).toBe("https://api.telnyx.com/v2/messages");
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
			from: "+18005550100",
			to: "+15125550123",
			text: "Hi",
			messaging_profile_id: "profile-1",
		});
		expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(
			"Bearer test-key",
		);
	});

	it("reports Telnyx's status and error code on refusal", async () => {
		const { fetcher } = recordingFetcher(422, {
			errors: [{ code: "40300" }],
		});
		const client = new TelnyxClient(
			liveEnv,
			new RateLimiter(10, 10, fakeClock()),
			fetcher,
		);

		const error = await client
			.send({ to: "+15125550123", text: "Hi" })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(TelnyxSendError);
		expect((error as TelnyxSendError).status).toBe(422);
		expect((error as TelnyxSendError).code).toBe("40300");
	});

	it("rejects a recipient that is not E.164 before anything else", async () => {
		const { fetcher, calls } = recordingFetcher(200, {});
		const client = new TelnyxClient(
			liveEnv,
			new RateLimiter(10, 10, fakeClock()),
			fetcher,
		);

		await expect(client.send({ to: "5125550123", text: "Hi" })).rejects.toThrow(
			"E.164",
		);
		expect(calls).toHaveLength(0);
	});

	it("waits on the limiter for the sending number", async () => {
		const clock = fakeClock();
		const { fetcher } = recordingFetcher(200, { data: { id: "msg" } });
		const client = new TelnyxClient(
			liveEnv,
			new RateLimiter(1, 1, clock),
			fetcher,
		);

		await client.send({ to: "+15125550123", text: "one" });
		await client.send({ to: "+15125550124", text: "two" });

		expect(clock.slept).toEqual([1000]);
	});
});
