import type { RateLimiterConfig } from './types.js';

export class RateLimiter {
  private readonly intervalMs: number;
  private tokens: number;
  private lastRefillTime: number;
  private readonly maxTokens: number;

  constructor(config: RateLimiterConfig) {
    const requestsPerSecond = config.maxRequestsPerMinute / 60;
    this.intervalMs = 1000 / requestsPerSecond;
    this.maxTokens = 1;
    this.tokens = 1;
    this.lastRefillTime = performance.now();
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    const waitMs = this.intervalMs * (1 - this.tokens);
    await this.sleep(waitMs);

    this.refill();
    this.tokens -= 1;
  }

  tryAcquire(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefillTime = performance.now();
  }

  private refill(): void {
    const now = performance.now();
    const elapsed = now - this.lastRefillTime;
    const tokensToAdd = elapsed / this.intervalMs;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
