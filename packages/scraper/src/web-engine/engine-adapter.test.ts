import { describe, it, expect } from 'vitest';
import { EngineAdapter } from './engine-adapter.js';
import type { FetchResponse, WebContentParser } from './types.js';

class MockEngineAdapter extends EngineAdapter {
  readonly engineType = 'ulixee' as const;
  readonly cleanupCalled: boolean[] = [];
  private readonly mockResult: FetchResponse<unknown>;

  constructor(result?: FetchResponse<unknown>) {
    super();
    this.mockResult = result ?? {
      success: true,
      title: 'Test',
      content: { data: 'test' },
      metadata: { duration: 100, method: 'mock' },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fetch<T>(_url?: string, _options?: unknown): Promise<FetchResponse<T>> {
    return this.mockResult as FetchResponse<T>;
  }

  async cleanup(): Promise<void> {
    this.cleanupCalled.push(true);
  }
}

describe('EngineAdapter', () => {
  it('adapter returns FetchResponse shape', async () => {
    const adapter = new MockEngineAdapter();

    const result = await adapter.fetch('https://example.com', {
      htmlParser: {} as WebContentParser<string, unknown>,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.title).toBe('Test');
      expect(result.content).toEqual({ data: 'test' });
      expect(result.metadata.method).toBe('mock');
    }
  });

  it('cleanup delegates to underlying engine', async () => {
    const adapter = new MockEngineAdapter();
    await adapter.cleanup();

    expect(adapter.cleanupCalled).toHaveLength(1);
  });

  it('engineType returns correct value', () => {
    const adapter = new MockEngineAdapter();
    expect(adapter.engineType).toBe('ulixee');
  });

  it('adapter returns error response shape', async () => {
    const errorAdapter = new MockEngineAdapter({
      success: false,
      error: 'blocked',
      errorCode: 'blocked',
      metadata: { duration: 50, method: 'mock' },
    });

    const result = await errorAdapter.fetch('https://example.com', {
      htmlParser: {} as WebContentParser<string, unknown>,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('blocked');
    }
  });
});
