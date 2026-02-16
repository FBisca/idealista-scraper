type ErrorClass = 'hard-block' | 'soft-block' | 'network' | 'parse' | 'system';

type RetryDecision = {
  shouldRetry: boolean;
  delayMs: number;
  rotateSession: boolean;
  errorClass: ErrorClass;
};

type RateLimiterConfig = {
  maxRequestsPerMinute: number;
};

export type { ErrorClass, RetryDecision, RateLimiterConfig };
