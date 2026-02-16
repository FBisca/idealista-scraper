import { describe, it, expect } from 'vitest';
import { SessionPool } from './session-pool.js';
import { Session } from './session.js';

describe('SessionPool', () => {
  it('acquire returns a session', () => {
    const pool = new SessionPool({ maxPoolSize: 3 });
    const session = pool.acquire();

    expect(session).toBeDefined();
    expect(session?.info.state).toBe('healthy');
  });

  it('markBad transitions session state to degraded', () => {
    const pool = new SessionPool({
      maxPoolSize: 1,
      degradedAfterErrors: 2,
    });

    const session = pool.acquire()!;
    session.markBad();
    expect(session.currentState).toBe('healthy');

    session.markBad();
    expect(session.currentState).toBe('degraded');
  });

  it('retire removes and replaces session', () => {
    const pool = new SessionPool({ maxPoolSize: 2 });

    const session = pool.acquire()!;
    const originalId = session.id;
    session.retire();

    const next = pool.acquire()!;
    expect(next).toBeDefined();
    expect(next.id).not.toBe(originalId);

    const stats = pool.getStats();
    expect(stats.blocked).toBe(0);
    expect(stats.total).toBe(2);
  });

  it('pool maintains target size after retirement', () => {
    const pool = new SessionPool({ maxPoolSize: 3 });

    const session1 = pool.acquire()!;
    const session2 = pool.acquire()!;
    session1.retire();
    session2.retire();

    pool.acquire();

    const stats = pool.getStats();
    expect(stats.total).toBe(3);
  });

  it('random selection distributes across sessions', () => {
    const pool = new SessionPool({ maxPoolSize: 5 });

    const selectedIds = new Set<string>();
    for (let index = 0; index < 50; index++) {
      const session = pool.acquire()!;
      selectedIds.add(session.id);
    }

    expect(selectedIds.size).toBeGreaterThan(1);
  });

  it('degraded session skipped during cooldown', () => {
    const pool = new SessionPool({
      maxPoolSize: 1,
      degradedAfterErrors: 1,
      cooldownMs: 60_000,
    });

    const session = pool.acquire()!;
    session.markBad();

    const next = pool.acquire();
    expect(next).toBeUndefined();
  });

  it('getStats reports correct counts', () => {
    const pool = new SessionPool({
      maxPoolSize: 3,
      degradedAfterErrors: 1,
    });

    const sessions = pool.getSessions();
    expect(sessions).toHaveLength(3);

    const stats = pool.getStats();
    expect(stats.healthy).toBe(3);
    expect(stats.degraded).toBe(0);
    expect(stats.blocked).toBe(0);
  });

  it('cleanup releases all sessions', () => {
    const pool = new SessionPool({ maxPoolSize: 3 });
    pool.cleanup();

    const stats = pool.getStats();
    expect(stats.total).toBe(0);

    const session = pool.acquire();
    expect(session).toBeUndefined();
  });

  it('uses custom factory when provided', () => {
    let created = 0;
    const factory = () => {
      created += 1;
      return new Session('http://proxy:8080');
    };

    const pool = new SessionPool({ maxPoolSize: 2 }, factory);
    expect(created).toBe(2);

    const session = pool.acquire()!;
    expect(session.proxyUrl).toBe('http://proxy:8080');
  });
});
