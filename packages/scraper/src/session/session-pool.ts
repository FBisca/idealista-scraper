import type { SessionConfig, SessionInfo } from './types.js';
import { DEFAULT_SESSION_CONFIG } from './types.js';
import { Session } from './session.js';

type SessionPoolStats = {
  total: number;
  healthy: number;
  degraded: number;
  blocked: number;
};

type SessionFactory = () => Session;

export class SessionPool {
  private readonly sessions: Session[];
  private readonly config: SessionConfig;
  private readonly factory: SessionFactory;

  constructor(config?: Partial<SessionConfig>, factory?: SessionFactory) {
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config };
    this.factory = factory ?? (() => new Session(undefined, this.config));
    this.sessions = [];

    for (let index = 0; index < this.config.maxPoolSize; index++) {
      this.sessions.push(this.factory());
    }
  }

  acquire(): Session | undefined {
    this.replaceBlockedSessions();

    const usable = this.sessions.filter((session) => session.isUsable());

    if (usable.length === 0) {
      return undefined;
    }

    return usable[Math.floor(Math.random() * usable.length)];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  release(_session: Session): void {
    // No-op for now; sessions remain in pool.
    // Future: track active vs idle for concurrency limits.
  }

  getStats(): SessionPoolStats {
    let healthy = 0;
    let degraded = 0;
    let blocked = 0;

    for (const session of this.sessions) {
      switch (session.currentState) {
        case 'healthy':
          healthy += 1;
          break;
        case 'degraded':
          degraded += 1;
          break;
        case 'blocked':
          blocked += 1;
          break;
      }
    }

    return { total: this.sessions.length, healthy, degraded, blocked };
  }

  getSessions(): readonly SessionInfo[] {
    return this.sessions.map((session) => session.info);
  }

  cleanup(): void {
    this.sessions.length = 0;
  }

  private replaceBlockedSessions(): void {
    for (let index = 0; index < this.sessions.length; index++) {
      const session = this.sessions[index];
      if (session && session.currentState === 'blocked') {
        this.sessions[index] = this.factory();
      }
    }
  }
}

export type { SessionPoolStats };
