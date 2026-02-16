import type { ErrorClass, RetryDecision } from './types.js';
import type { FetchResponse } from '../web-engine/types.js';

type ClassifyInput = {
  response?: FetchResponse<unknown>;
  captchaDetected?: boolean;
  errorMessage?: string;
};

type RetryStrategyConfig = {
  maxRetries: number;
};

const DEFAULT_CONFIG: RetryStrategyConfig = {
  maxRetries: 3,
};

export class RetryStrategy {
  private readonly config: RetryStrategyConfig;

  constructor(config?: Partial<RetryStrategyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  classify(input: ClassifyInput): ErrorClass {
    if (input.captchaDetected) {
      return 'hard-block';
    }

    if (input.response && !input.response.success) {
      const errorCode = input.response.errorCode;

      if (errorCode === 'blocked') {
        return 'hard-block';
      }

      if (errorCode === 'unsupported-interaction') {
        return 'parse';
      }
    }

    const message = input.errorMessage?.toLowerCase() ?? '';

    if (message.includes('403')) {
      return 'hard-block';
    }

    if (message.includes('429') || message.includes('too many requests')) {
      return 'soft-block';
    }

    if (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('socket hang up') ||
      message.includes('network')
    ) {
      return 'network';
    }

    if (
      message.includes('parse') ||
      message.includes('extract') ||
      message.includes('selector')
    ) {
      return 'parse';
    }

    return 'system';
  }

  decide(errorClass: ErrorClass, retryCount: number): RetryDecision {
    const maxRetries = this.config.maxRetries;

    switch (errorClass) {
      case 'hard-block':
        return {
          shouldRetry: retryCount < maxRetries,
          delayMs: 2000 + Math.random() * 2000,
          rotateSession: true,
          errorClass,
        };

      case 'soft-block':
        return {
          shouldRetry: retryCount < maxRetries,
          delayMs: Math.min(1000 * Math.pow(2, retryCount), 4000),
          rotateSession: false,
          errorClass,
        };

      case 'network':
        return {
          shouldRetry: retryCount < maxRetries,
          delayMs: 0,
          rotateSession: false,
          errorClass,
        };

      case 'parse':
        return {
          shouldRetry: false,
          delayMs: 0,
          rotateSession: false,
          errorClass,
        };

      case 'system':
        return {
          shouldRetry: false,
          delayMs: 0,
          rotateSession: false,
          errorClass,
        };
    }
  }
}
