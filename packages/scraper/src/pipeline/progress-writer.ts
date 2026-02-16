import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { ProgressEntry } from './types.js';

export class ProgressWriter<T> {
  private readonly outputPath: string;
  private readonly tmpPath: string;
  private lineCount: number;

  constructor(outputPath: string) {
    this.outputPath = outputPath;
    this.tmpPath = `${outputPath}.tmp`;
    this.lineCount = 0;
  }

  initialize(): void {
    const dir = dirname(this.tmpPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (existsSync(this.tmpPath)) {
      this.lineCount = this.countLines();
      return;
    }

    writeFileSync(this.tmpPath, '', 'utf-8');
    this.lineCount = 0;
  }

  append(id: string, data: T): void {
    const entry: ProgressEntry<T> = {
      id,
      timestamp: Date.now(),
      data,
    };

    appendFileSync(this.tmpPath, JSON.stringify(entry) + '\n', 'utf-8');
    this.lineCount += 1;
  }

  finalize(): void {
    if (existsSync(this.tmpPath)) {
      renameSync(this.tmpPath, this.outputPath);
    }
  }

  readCompletedIds(): Set<string> {
    const entries = this.readEntries();
    return new Set(entries.map((entry) => entry.id));
  }

  readAll(): ProgressEntry<T>[] {
    return this.readEntries();
  }

  getLineCount(): number {
    return this.lineCount;
  }

  hasTmpFile(): boolean {
    return existsSync(this.tmpPath);
  }

  private readEntries(): ProgressEntry<T>[] {
    const filePath = existsSync(this.tmpPath) ? this.tmpPath : this.outputPath;

    if (!existsSync(filePath)) {
      return [];
    }

    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) {
      return [];
    }

    const entries: ProgressEntry<T>[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        entries.push(JSON.parse(trimmed) as ProgressEntry<T>);
      } catch {
        continue;
      }
    }

    return entries;
  }

  private countLines(): number {
    if (!existsSync(this.tmpPath)) {
      return 0;
    }

    const content = readFileSync(this.tmpPath, 'utf-8').trim();
    if (!content) {
      return 0;
    }

    return content.split('\n').filter((line) => line.trim().length > 0).length;
  }
}
