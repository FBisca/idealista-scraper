type SessionState = 'healthy' | 'degraded' | 'blocked';

type SessionConfig = {
  maxPoolSize: number;
  maxUsageCount: number;
  maxAgeMs: number;
  cooldownMs: number;
  degradedAfterErrors: number;
};

type SessionInfo = {
  id: string;
  proxyUrl?: string;
  state: SessionState;
  usageCount: number;
  consecutiveErrors: number;
  createdAt: number;
  lastUsedAt: number;
};

const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxPoolSize: 1,
  maxUsageCount: 100,
  maxAgeMs: 30 * 60 * 1000,
  cooldownMs: 10_000,
  degradedAfterErrors: 3,
};

export type { SessionState, SessionConfig, SessionInfo };
export { DEFAULT_SESSION_CONFIG };
