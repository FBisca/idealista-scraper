import { describe, it, expect } from 'vitest';
import { EnginePool } from './engine-pool.js';
import { EngineAdapter } from './engine-adapter.js';
import type { FetchResponse } from './types.js';

class StubAdapter extends EngineAdapter {
  readonly engineType = 'ulixee' as const;
  cleaned = false;

  async fetch<T>(): Promise<FetchResponse<T>> {
    return {
      success: true,
      title: 'stub',
      content: {} as T,
      metadata: { duration: 0, method: 'stub' },
    };
  }

  async cleanup(): Promise<void> {
    this.cleaned = true;
  }
}

describe('EnginePool', () => {
  it('acquire returns adapter when pool has idle instance', async () => {
    const pool = new EnginePool(() => new StubAdapter(), { maxSize: 2 });

    const adapter = await pool.acquire();
    pool.release(adapter);

    const reused = await pool.acquire();
    expect(reused).toBe(adapter);
  });

  it('acquire creates new instance when pool not full', async () => {
    const pool = new EnginePool(() => new StubAdapter(), { maxSize: 3 });

    const first = await pool.acquire();
    const second = await pool.acquire();

    expect(first).not.toBe(second);
    expect(pool.activeCount).toBe(2);
  });

  it('acquire waits when pool full and all active', async () => {
    const pool = new EnginePool(() => new StubAdapter(), { maxSize: 1 });

    const first = await pool.acquire();
    let resolved = false;

    const waitPromise = pool.acquire().then((adapter) => {
      resolved = true;
      return adapter;
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(resolved).toBe(false);

    pool.release(first);
    const second = await waitPromise;

    expect(resolved).toBe(true);
    expect(second).toBe(first);
  });

  it('release returns instance to idle', async () => {
    const pool = new EnginePool(() => new StubAdapter(), { maxSize: 2 });

    const adapter = await pool.acquire();
    expect(pool.activeCount).toBe(1);
    expect(pool.idleCount).toBe(0);

    pool.release(adapter);
    expect(pool.activeCount).toBe(0);
    expect(pool.idleCount).toBe(1);
  });

  it('cleanup closes all instances', async () => {
    const adapters: StubAdapter[] = [];
    const pool = new EnginePool(
      () => {
        const adapter = new StubAdapter();
        adapters.push(adapter);
        return adapter;
      },
      { maxSize: 3 },
    );

    await pool.acquire();
    await pool.acquire();
    const third = await pool.acquire();
    pool.release(third);

    await pool.cleanup();

    expect(adapters.every((adapter) => adapter.cleaned)).toBe(true);
    expect(pool.totalCount).toBe(0);
  });

  it('max pool size enforcement', async () => {
    let created = 0;
    const pool = new EnginePool(
      () => {
        created += 1;
        return new StubAdapter();
      },
      { maxSize: 2 },
    );

    await pool.acquire();
    await pool.acquire();

    expect(created).toBe(2);
    expect(pool.activeCount).toBe(2);
  });
});
