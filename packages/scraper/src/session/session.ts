import { randomUUID } from 'node:crypto';
import type { SessionConfig, SessionInfo, SessionState } from './types.js';
import { DEFAULT_SESSION_CONFIG } from './types.js';

export class Session {
  readonly id: string;
  readonly proxyUrl: string | undefined;
  private state: SessionState;
  private usageCount: number;
  private consecutiveErrors: number;
  private readonly createdAt: number;
  private lastUsedAt: number;
  private degradedUntil: number;
  private readonly config: SessionConfig;

  constructor(proxyUrl?: string, config?: Partial<SessionConfig>) {
    this.id = randomUUID();
    this.proxyUrl = proxyUrl;
    this.state = 'healthy';
    this.usageCount = 0;
    this.consecutiveErrors = 0;
    this.createdAt = Date.now();
    this.lastUsedAt = Date.now();
    this.degradedUntil = 0;
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config };
  }

  markGood(): void {
    this.consecutiveErrors = 0;
    this.usageCount += 1;
    this.lastUsedAt = Date.now();

    if (this.state === 'degraded') {
      this.state = 'healthy';
      this.degradedUntil = 0;
    }

    if (this.shouldAutoRetire()) {
      this.retire();
    }
  }

  markBad(): void {
    this.consecutiveErrors += 1;
    this.usageCount += 1;
    this.lastUsedAt = Date.now();

    if (this.consecutiveErrors >= this.config.degradedAfterErrors) {
      this.state = 'degraded';
      this.degradedUntil = Date.now() + this.config.cooldownMs;
    }

    if (this.shouldAutoRetire()) {
      this.retire();
    }
  }

  retire(): void {
    this.state = 'blocked';
  }

  isUsable(): boolean {
    if (this.state === 'blocked') {
      return false;
    }

    if (this.state === 'degraded' && Date.now() < this.degradedUntil) {
      return false;
    }

    if (this.shouldAutoRetire()) {
      this.retire();
      return false;
    }

    return true;
  }

  get info(): SessionInfo {
    return {
      id: this.id,
      proxyUrl: this.proxyUrl,
      state: this.state,
      usageCount: this.usageCount,
      consecutiveErrors: this.consecutiveErrors,
      createdAt: this.createdAt,
      lastUsedAt: this.lastUsedAt,
    };
  }

  get currentState(): SessionState {
    return this.state;
  }

  private shouldAutoRetire(): boolean {
    if (this.usageCount >= this.config.maxUsageCount) {
      return true;
    }

    if (Date.now() - this.createdAt >= this.config.maxAgeMs) {
      return true;
    }

    return false;
  }
}
