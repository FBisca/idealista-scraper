import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { CrawlStateSnapshot } from './types.js';

export class CrawlState {
  private readonly statePath: string;
  private snapshot: CrawlStateSnapshot;

  constructor(statePath: string, sourceUrl: string) {
    this.statePath = statePath;
    this.snapshot = {
      sourceUrl,
      discoveredIds: [],
      completedIds: [],
      failedIds: [],
      lastListPage: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  load(): boolean {
    if (!existsSync(this.statePath)) {
      return false;
    }

    try {
      const content = readFileSync(this.statePath, 'utf-8');
      const saved = JSON.parse(content) as CrawlStateSnapshot;

      if (saved.sourceUrl !== this.snapshot.sourceUrl) {
        return false;
      }

      this.snapshot = saved;
      return true;
    } catch {
      return false;
    }
  }

  save(): void {
    this.snapshot.updatedAt = Date.now();

    const dir = dirname(this.statePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(
      this.statePath,
      JSON.stringify(this.snapshot, null, 2),
      'utf-8',
    );
  }

  addDiscoveredIds(ids: string[]): void {
    const existing = new Set(this.snapshot.discoveredIds);

    for (const id of ids) {
      if (!existing.has(id)) {
        existing.add(id);
        this.snapshot.discoveredIds.push(id);
      }
    }
  }

  markCompleted(id: string): void {
    if (!this.snapshot.completedIds.includes(id)) {
      this.snapshot.completedIds.push(id);
    }
  }

  markFailed(id: string): void {
    if (!this.snapshot.failedIds.includes(id)) {
      this.snapshot.failedIds.push(id);
    }
  }

  setLastListPage(page: number): void {
    this.snapshot.lastListPage = page;
  }

  get pendingIds(): string[] {
    const completed = new Set(this.snapshot.completedIds);
    const failed = new Set(this.snapshot.failedIds);

    return this.snapshot.discoveredIds.filter(
      (id) => !completed.has(id) && !failed.has(id),
    );
  }

  get lastListPage(): number {
    return this.snapshot.lastListPage;
  }

  get discoveredIds(): readonly string[] {
    return this.snapshot.discoveredIds;
  }

  get completedIds(): readonly string[] {
    return this.snapshot.completedIds;
  }

  get failedIds(): readonly string[] {
    return this.snapshot.failedIds;
  }

  get sourceUrl(): string {
    return this.snapshot.sourceUrl;
  }

  cleanup(): void {
    if (existsSync(this.statePath)) {
      rmSync(this.statePath);
    }
  }
}
