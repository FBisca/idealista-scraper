import { describe, it, expect, vi } from 'vitest';
import { Router } from './router.js';
import type { CrawlContext, CrawlRequest, HandlerFn } from './types.js';

function makeRequest(overrides?: Partial<CrawlRequest>): CrawlRequest {
  return {
    url: 'https://example.com',
    uniqueKey: 'https://example.com',
    retryCount: 0,
    ...overrides,
  };
}

describe('Router', () => {
  it('addHandler registers by label', () => {
    const router = new Router();
    const handler: HandlerFn = vi.fn();

    router.addHandler('LIST', handler);

    const resolved = router.route(makeRequest({ label: 'LIST' }));
    expect(resolved).toBe(handler);
  });

  it('route returns correct handler for label', () => {
    const router = new Router();
    const listHandler: HandlerFn = vi.fn();
    const detailHandler: HandlerFn = vi.fn();

    router.addHandler('LIST', listHandler);
    router.addHandler('DETAIL', detailHandler);

    expect(router.route(makeRequest({ label: 'LIST' }))).toBe(listHandler);
    expect(router.route(makeRequest({ label: 'DETAIL' }))).toBe(detailHandler);
  });

  it('default handler used for unlabeled request', () => {
    const router = new Router();
    const defaultHandler: HandlerFn = vi.fn();

    router.addDefaultHandler(defaultHandler);

    const resolved = router.route(makeRequest({ label: undefined }));
    expect(resolved).toBe(defaultHandler);
  });

  it('default handler used when label has no registered handler', () => {
    const router = new Router();
    const defaultHandler: HandlerFn = vi.fn();

    router.addDefaultHandler(defaultHandler);

    const resolved = router.route(makeRequest({ label: 'UNKNOWN' }));
    expect(resolved).toBe(defaultHandler);
  });

  it('error thrown when no handler matches and no default', () => {
    const router = new Router();

    expect(() => router.route(makeRequest({ label: 'MISSING' }))).toThrow(
      /No handler registered for label "MISSING"/,
    );
  });

  it('error thrown for unlabeled request with no default', () => {
    const router = new Router();

    expect(() => router.route(makeRequest({ label: undefined }))).toThrow(
      /no default handler set/,
    );
  });

  it('multiple handlers for different labels dispatch correctly', () => {
    const router = new Router();
    const handlers: Record<string, HandlerFn> = {};

    for (const label of ['A', 'B', 'C']) {
      const handler: HandlerFn = vi.fn();
      handlers[label] = handler;
      router.addHandler(label, handler);
    }

    for (const label of ['A', 'B', 'C']) {
      const resolved = router.route(makeRequest({ label }));
      expect(resolved).toBe(handlers[label]);
    }
  });

  it('handler receives CrawlContext when invoked', async () => {
    const router = new Router();
    let receivedContext: CrawlContext | undefined;

    router.addHandler('TEST', async (context) => {
      receivedContext = context;
    });

    const handler = router.route(makeRequest({ label: 'TEST' }));

    const mockContext: CrawlContext = {
      request: makeRequest({ label: 'TEST' }),
      fetchPage: vi.fn(),
      pushData: vi.fn(),
      enqueue: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    await handler(mockContext);

    expect(receivedContext).toBe(mockContext);
  });
});
