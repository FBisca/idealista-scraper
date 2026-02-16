import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { fetchWithHttp } from './crawlee-engine.js';
import { WebContentParser, type WebContent } from './types.js';

vi.mock('got-scraping', () => ({
  gotScraping: vi.fn(),
}));

class TestParser extends WebContentParser<string, { title: string }> {
  async extract(content: WebContent<string>): Promise<{ title: string }> {
    return { title: `parsed:${content.url}` };
  }
}

let mock: Mock;

describe('fetchWithHttp', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mod = await import('got-scraping');
    mock = mod.gotScraping as unknown as Mock;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns parsed content on successful HTTP response', async () => {
    mock.mockResolvedValueOnce({
      statusCode: 200,
      body: '<html><head><title>Test Page</title></head><body>Hello</body></html>',
      url: 'https://example.com/page',
    } as never);

    const result = await fetchWithHttp('https://example.com/page', {
      htmlParser: new TestParser(),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.title).toBe('Test Page');
      expect(result.content).toEqual({
        title: 'parsed:https://example.com/page',
      });
      expect(result.metadata.method).toBe('crawlee-http');
      expect(result.metadata.statusCode).toBe(200);
    }
  });

  it('returns blocked error on HTTP 403', async () => {
    mock.mockResolvedValueOnce({
      statusCode: 403,
      body: 'Forbidden',
      url: 'https://example.com/blocked',
    } as never);

    const result = await fetchWithHttp('https://example.com/blocked', {
      htmlParser: new TestParser(),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('blocked');
      expect(result.error).toBe('HTTP 403');
    }
  });

  it('returns blocked error on HTTP 429', async () => {
    mock.mockResolvedValueOnce({
      statusCode: 429,
      body: 'Too Many Requests',
      url: 'https://example.com/rate-limited',
    } as never);

    const result = await fetchWithHttp('https://example.com/rate-limited', {
      htmlParser: new TestParser(),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('blocked');
      expect(result.error).toBe('HTTP 429');
    }
  });

  it('returns unexpected error on HTTP 500', async () => {
    mock.mockResolvedValueOnce({
      statusCode: 500,
      body: 'Server Error',
      url: 'https://example.com/error',
    } as never);

    const result = await fetchWithHttp('https://example.com/error', {
      htmlParser: new TestParser(),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('unexpected');
      expect(result.error).toBe('HTTP 500');
    }
  });

  it('returns unexpected error on network failure', async () => {
    mock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await fetchWithHttp('https://example.com/down', {
      htmlParser: new TestParser(),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('unexpected');
      expect(result.error).toBe('ECONNREFUSED');
    }
  });

  it('passes custom headers through config', async () => {
    mock.mockResolvedValueOnce({
      statusCode: 200,
      body: '<html><head><title>T</title></head></html>',
      url: 'https://example.com',
    } as never);

    await fetchWithHttp(
      'https://example.com',
      { htmlParser: new TestParser() },
      { headers: { 'X-Custom': 'value' } },
    );

    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Custom': 'value' }),
      }),
    );
  });

  it('uses redirect URL as final URL', async () => {
    mock.mockResolvedValueOnce({
      statusCode: 200,
      body: '<html><head><title>Redirected</title></head></html>',
      url: 'https://example.com/final',
    } as never);

    const result = await fetchWithHttp('https://example.com/start', {
      htmlParser: new TestParser(),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toEqual({
        title: 'parsed:https://example.com/final',
      });
    }
  });

  it('includes duration in metadata', async () => {
    mock.mockResolvedValueOnce({
      statusCode: 200,
      body: '<html><head><title>T</title></head></html>',
      url: 'https://example.com',
    } as never);

    const result = await fetchWithHttp('https://example.com', {
      htmlParser: new TestParser(),
    });

    expect(result.metadata.duration).toBeTypeOf('number');
    expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
  });
});
