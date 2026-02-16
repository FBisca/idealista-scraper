import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RequestQueue } from './request-queue.js';

const TEST_DIR = join(process.cwd(), 'tmp', 'test-request-queue');
const PERSIST_PATH = join(TEST_DIR, 'queue.jsonl');

function cleanup(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('RequestQueue', () => {
  beforeEach(() => {
    cleanup();
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('enqueues and dequeues in FIFO order', () => {
    const queue = new RequestQueue();
    queue.enqueue('https://example.com/a');
    queue.enqueue('https://example.com/b');
    queue.enqueue('https://example.com/c');

    const first = queue.dequeue();
    const second = queue.dequeue();
    const third = queue.dequeue();

    expect(first?.url).toBe('https://example.com/a');
    expect(second?.url).toBe('https://example.com/b');
    expect(third?.url).toBe('https://example.com/c');
  });

  it('deduplicates entries with same uniqueKey', () => {
    const queue = new RequestQueue();
    const added1 = queue.enqueue('https://example.com/page');
    const added2 = queue.enqueue('https://example.com/page');

    expect(added1).toBe(true);
    expect(added2).toBe(false);
    expect(queue.size()).toBe(1);
  });

  it('transitions state: pending → in-progress → handled', () => {
    const queue = new RequestQueue();
    queue.enqueue('https://example.com/page');

    expect(queue.size('pending')).toBe(1);

    const entry = queue.dequeue();
    expect(entry?.state).toBe('in-progress');
    expect(queue.size('in-progress')).toBe(1);
    expect(queue.size('pending')).toBe(0);

    queue.markHandled(entry!.uniqueKey);
    expect(queue.size('handled')).toBe(1);
    expect(queue.size('in-progress')).toBe(0);
  });

  it('persists and reloads state', () => {
    const queue = new RequestQueue({ persistPath: PERSIST_PATH });
    queue.enqueue('https://example.com/1', 'LIST');
    queue.enqueue('https://example.com/2', 'DETAIL');

    const entry = queue.dequeue();
    queue.markHandled(entry!.uniqueKey);

    const reloaded = new RequestQueue({
      persistPath: PERSIST_PATH,
      resume: true,
    });

    expect(reloaded.size()).toBe(2);
    expect(reloaded.size('handled')).toBe(1);
    expect(reloaded.size('pending')).toBe(1);
  });

  it('crash recovery moves in-progress back to pending', () => {
    const queue = new RequestQueue({ persistPath: PERSIST_PATH });
    queue.enqueue('https://example.com/a');
    queue.enqueue('https://example.com/b');
    queue.dequeue();

    const reloaded = new RequestQueue({
      persistPath: PERSIST_PATH,
      resume: true,
    });

    expect(reloaded.size('in-progress')).toBe(0);
    expect(reloaded.size('pending')).toBe(2);
  });

  it('markFailed records error', () => {
    const queue = new RequestQueue();
    queue.enqueue('https://example.com/page');
    const entry = queue.dequeue()!;

    queue.markFailed(entry.uniqueKey, 'HTTP 403');

    const failed = queue.getEntry(entry.uniqueKey);
    expect(failed?.state).toBe('failed');
    expect(failed?.errors).toContain('HTTP 403');
  });

  it('batch enqueue adds multiple items', () => {
    const queue = new RequestQueue();
    const added = queue.enqueueBatch([
      { url: 'https://example.com/1', label: 'L' },
      { url: 'https://example.com/2', label: 'L' },
      { url: 'https://example.com/1', label: 'L' },
    ]);

    expect(added).toBe(2);
    expect(queue.size()).toBe(2);
  });

  it('size reports by state partition', () => {
    const queue = new RequestQueue();
    queue.enqueue('https://example.com/a');
    queue.enqueue('https://example.com/b');
    queue.enqueue('https://example.com/c');

    queue.dequeue();
    const second = queue.dequeue()!;
    queue.markHandled(second.uniqueKey);

    expect(queue.size('pending')).toBe(1);
    expect(queue.size('in-progress')).toBe(1);
    expect(queue.size('handled')).toBe(1);
    expect(queue.size()).toBe(3);
  });

  it('isEmpty returns true when no pending or in-progress', () => {
    const queue = new RequestQueue();
    expect(queue.isEmpty()).toBe(true);

    queue.enqueue('https://example.com/a');
    expect(queue.isEmpty()).toBe(false);

    const entry = queue.dequeue()!;
    expect(queue.isEmpty()).toBe(false);

    queue.markHandled(entry.uniqueKey);
    expect(queue.isEmpty()).toBe(true);
  });

  it('preserves label and userData', () => {
    const queue = new RequestQueue();
    queue.enqueue('https://example.com/page', 'DETAIL', { propertyId: '123' });

    const entry = queue.dequeue();
    expect(entry?.label).toBe('DETAIL');
    expect(entry?.userData).toEqual({ propertyId: '123' });
  });

  it('requeue increments retryCount and sets state to pending', () => {
    const queue = new RequestQueue();
    queue.enqueue('https://example.com/page');
    const entry = queue.dequeue()!;

    queue.requeue(entry.uniqueKey);

    const requeued = queue.getEntry(entry.uniqueKey);
    expect(requeued?.state).toBe('pending');
    expect(requeued?.retryCount).toBe(1);
  });
});
