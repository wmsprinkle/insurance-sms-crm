import { SMS } from "./sms-config";

export type Clock = {
	now: () => number;
	sleep: (ms: number) => Promise<void>;
};

const systemClock: Clock = {
	now: () => Date.now(),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class TokenBucket {
	private tokens: number;
	private updatedAt: number;

	constructor(
		private readonly perSecond: number,
		private readonly capacity: number,
		now: number,
	) {
		this.tokens = capacity;
		this.updatedAt = now;
	}

	reserve(now: number): number {
		const elapsed = Math.max(0, now - this.updatedAt);
		this.tokens = Math.min(
			this.capacity,
			this.tokens + (elapsed / 1_000) * this.perSecond,
		);
		this.updatedAt = now;
		this.tokens -= 1;

		return this.tokens >= 0
			? 0
			: Math.ceil((-this.tokens / this.perSecond) * 1_000);
	}
}

export class RateLimiter {
	private readonly buckets = new Map<string, TokenBucket>();

	constructor(
		private readonly perSecond: number = SMS.rate.defaultMessagesPerSecond,
		private readonly burst: number = SMS.rate.burst,
		private readonly clock: Clock = systemClock,
	) {}

	async acquire(key: string): Promise<number> {
		const now = this.clock.now();
		let bucket = this.buckets.get(key);
		if (!bucket) {
			bucket = new TokenBucket(this.perSecond, this.burst, now);
			this.buckets.set(key, bucket);
		}

		const waitMs = bucket.reserve(now);
		if (waitMs > 0) await this.clock.sleep(waitMs);

		return waitMs;
	}
}
