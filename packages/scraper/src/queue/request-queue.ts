import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { QueueEntry, QueueOptions, RequestState } from './types.js';

export class RequestQueue {
  private readonly entries: Map<string, QueueEntry>;
  private readonly insertionOrder: string[];
  private readonly persistPath: string | undefined;

  constructor(options?: QueueOptions) {
    this.entries = new Map();
    this.insertionOrder = [];
    this.persistPath = options?.persistPath;

    if (options?.resume && this.persistPath && existsSync(this.persistPath)) {
      this.loadFromDisk();
      this.recoverInProgress();
    }
  }

  enqueue(
    url: string,
    label?: string,
    userData?: Record<string, unknown>,
  ): boolean {
    const uniqueKey = this.deriveUniqueKey(url);

    if (this.entries.has(uniqueKey)) {
      return false;
    }

    const entry: QueueEntry = {
      url,
      uniqueKey,
      label,
      state: 'pending',
      retryCount: 0,
      userData,
      errors: [],
    };

    this.entries.set(uniqueKey, entry);
    this.insertionOrder.push(uniqueKey);
    this.persistEntry(entry);

    return true;
  }

  enqueueBatch(
    items: Array<{
      url: string;
      label?: string;
      userData?: Record<string, unknown>;
    }>,
  ): number {
    let added = 0;

    for (const item of items) {
      if (this.enqueue(item.url, item.label, item.userData)) {
        added += 1;
      }
    }

    return added;
  }

  dequeue(): QueueEntry | undefined {
    for (const key of this.insertionOrder) {
      const entry = this.entries.get(key);
      if (entry?.state === 'pending') {
        entry.state = 'in-progress';
        this.persistState();
        return entry;
      }
    }

    return undefined;
  }

  markHandled(uniqueKey: string): void {
    const entry = this.entries.get(uniqueKey);
    if (entry) {
      entry.state = 'handled';
      this.persistState();
    }
  }

  markFailed(uniqueKey: string, error: string): void {
    const entry = this.entries.get(uniqueKey);
    if (entry) {
      entry.state = 'failed';
      entry.errors.push(error);
      this.persistState();
    }
  }

  requeue(uniqueKey: string): void {
    const entry = this.entries.get(uniqueKey);
    if (entry) {
      entry.state = 'pending';
      entry.retryCount += 1;
      this.persistState();
    }
  }

  size(state?: RequestState): number {
    if (!state) {
      return this.entries.size;
    }

    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.state === state) {
        count += 1;
      }
    }

    return count;
  }

  isEmpty(): boolean {
    return this.size('pending') === 0 && this.size('in-progress') === 0;
  }

  getEntry(uniqueKey: string): QueueEntry | undefined {
    return this.entries.get(uniqueKey);
  }

  private deriveUniqueKey(url: string): string {
    return url;
  }

  private recoverInProgress(): void {
    for (const entry of this.entries.values()) {
      if (entry.state === 'in-progress') {
        entry.state = 'pending';
      }
    }

    this.persistState();
  }

  private persistEntry(entry: QueueEntry): void {
    if (!this.persistPath) {
      return;
    }

    const dir = dirname(this.persistPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    appendFileSync(this.persistPath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  private persistState(): void {
    if (!this.persistPath) {
      return;
    }

    const dir = dirname(this.persistPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const lines = this.insertionOrder
      .map((key) => {
        const entry = this.entries.get(key);
        return entry ? JSON.stringify(entry) : undefined;
      })
      .filter(Boolean)
      .join('\n');

    writeFileSync(this.persistPath, lines + '\n', 'utf-8');
  }

  private loadFromDisk(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) {
      return;
    }

    const content = readFileSync(this.persistPath, 'utf-8').trim();
    if (!content) {
      return;
    }

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const entry = JSON.parse(trimmed) as QueueEntry;
        if (!this.entries.has(entry.uniqueKey)) {
          this.entries.set(entry.uniqueKey, entry);
          this.insertionOrder.push(entry.uniqueKey);
        }
      } catch {
        continue;
      }
    }
  }
}
