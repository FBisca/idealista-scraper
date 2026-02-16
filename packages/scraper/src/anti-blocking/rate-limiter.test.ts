import { describe, it, expect } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  it('acquires a token immediately when available', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 60 });

    const start = performance.now();
    await limiter.acquire();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  it('spaces rapid calls according to configured rate', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 600 });

    const start = performance.now();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(150);
  });

  it('tryAcquire returns false when no tokens available', () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 60 });

    const first = limiter.tryAcquire();
    expect(first).toBe(true);

    const second = limiter.tryAcquire();
    expect(second).toBe(false);
  });

  it('reset restores full capacity', () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 60 });

    limiter.tryAcquire();
    expect(limiter.tryAcquire()).toBe(false);

    limiter.reset();
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('distributes tokens evenly per second', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 120 });

    const timestamps: number[] = [];
    for (let index = 0; index < 4; index++) {
      await limiter.acquire();
      timestamps.push(performance.now());
    }

    for (let index = 1; index < timestamps.length; index++) {
      const gap = timestamps[index]! - timestamps[index - 1]!;
      expect(gap).toBeGreaterThanOrEqual(400);
    }
  });
});
