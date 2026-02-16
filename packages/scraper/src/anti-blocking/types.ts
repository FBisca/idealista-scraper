type ErrorClass = 'hard-block' | 'soft-block' | 'network' | 'parse' | 'system';

type RetryDecision = {
  shouldRetry: boolean;
  delayMs: number;
  rotateSession: boolean;
  errorClass: ErrorClass;
};

export type { ErrorClass, RetryDecision };
