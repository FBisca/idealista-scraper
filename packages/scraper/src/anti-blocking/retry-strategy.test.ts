import { describe, it, expect } from 'vitest';
import { RetryStrategy } from './retry-strategy.js';
import type { FetchResponse } from '../web-engine/types.js';

function makeErrorResponse(
  errorCode: 'unexpected' | 'blocked' | 'unsupported-interaction',
  error = 'test error',
): FetchResponse<unknown> {
  return {
    success: false,
    error,
    errorCode,
    metadata: { duration: 100, method: 'test' },
  };
}

describe('RetryStrategy', () => {
  const strategy = new RetryStrategy({ maxRetries: 3 });

  it('classifies CAPTCHA response as hard-block', () => {
    const errorClass = strategy.classify({ captchaDetected: true });
    expect(errorClass).toBe('hard-block');
  });

  it('classifies 403 as hard-block', () => {
    const errorClass = strategy.classify({
      errorMessage: 'HTTP 403 Forbidden',
    });
    expect(errorClass).toBe('hard-block');
  });

  it('classifies blocked errorCode as hard-block', () => {
    const errorClass = strategy.classify({
      response: makeErrorResponse('blocked'),
    });
    expect(errorClass).toBe('hard-block');
  });

  it('classifies 429 as soft-block', () => {
    const errorClass = strategy.classify({
      errorMessage: '429 Too Many Requests',
    });
    expect(errorClass).toBe('soft-block');
  });

  it('classifies timeout as network', () => {
    const errorClass = strategy.classify({ errorMessage: 'Request timeout' });
    expect(errorClass).toBe('network');
  });

  it('classifies ECONNRESET as network', () => {
    const errorClass = strategy.classify({ errorMessage: 'ECONNRESET' });
    expect(errorClass).toBe('network');
  });

  it('classifies parse error as parse (no retry)', () => {
    const errorClass = strategy.classify({
      errorMessage: 'Failed to parse HTML',
    });
    expect(errorClass).toBe('parse');

    const decision = strategy.decide(errorClass, 0);
    expect(decision.shouldRetry).toBe(false);
  });

  it('classifies unsupported-interaction as parse', () => {
    const errorClass = strategy.classify({
      response: makeErrorResponse('unsupported-interaction'),
    });
    expect(errorClass).toBe('parse');
  });

  it('exponential backoff delay for soft-block', () => {
    const delay0 = strategy.decide('soft-block', 0).delayMs;
    const delay1 = strategy.decide('soft-block', 1).delayMs;
    const delay2 = strategy.decide('soft-block', 2).delayMs;

    expect(delay0).toBe(1000);
    expect(delay1).toBe(2000);
    expect(delay2).toBe(4000);
  });

  it('retry decision respects maxRetries', () => {
    const withinLimit = strategy.decide('network', 2);
    expect(withinLimit.shouldRetry).toBe(true);

    const atLimit = strategy.decide('network', 3);
    expect(atLimit.shouldRetry).toBe(false);
  });

  it('hard-block decision includes rotateSession=true', () => {
    const decision = strategy.decide('hard-block', 0);
    expect(decision.rotateSession).toBe(true);
    expect(decision.shouldRetry).toBe(true);
    expect(decision.delayMs).toBeGreaterThanOrEqual(2000);
    expect(decision.delayMs).toBeLessThanOrEqual(4000);
  });

  it('soft-block decision includes rotateSession=false', () => {
    const decision = strategy.decide('soft-block', 0);
    expect(decision.rotateSession).toBe(false);
    expect(decision.shouldRetry).toBe(true);
  });

  it('system error is not retried', () => {
    const errorClass = strategy.classify({
      errorMessage: 'Unknown system failure',
    });
    expect(errorClass).toBe('system');

    const decision = strategy.decide(errorClass, 0);
    expect(decision.shouldRetry).toBe(false);
  });

  it('network errors retry immediately (0 delay)', () => {
    const decision = strategy.decide('network', 0);
    expect(decision.delayMs).toBe(0);
    expect(decision.rotateSession).toBe(false);
  });
});
