import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ErrorClass } from '../anti-blocking/types.js';

type ErrorSnapshotData = {
  url: string;
  statusCode?: number;
  responseHeaders?: Record<string, unknown>;
  errorMessage: string;
  errorClass: ErrorClass;
  captchaSelector?: string;
  timestamp: number;
};

type ErrorSnapshotConfig = {
  directory: string;
  maxSnapshots: number;
};

const DEFAULT_CONFIG: ErrorSnapshotConfig = {
  directory: 'tmp/errors',
  maxSnapshots: 100,
};

export class ErrorSnapshotWriter {
  private readonly config: ErrorSnapshotConfig;
  private snapshotCount: number;

  constructor(config?: Partial<ErrorSnapshotConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.snapshotCount = 0;
  }

  initialize(): void {
    if (!existsSync(this.config.directory)) {
      mkdirSync(this.config.directory, { recursive: true });
    }

    this.snapshotCount = this.countExistingSnapshots();
  }

  write(id: string, data: ErrorSnapshotData, html?: string): boolean {
    if (this.snapshotCount >= this.config.maxSnapshots) {
      return false;
    }

    try {
      if (!existsSync(this.config.directory)) {
        mkdirSync(this.config.directory, { recursive: true });
      }

      const timestamp = Date.now();
      const baseName = `${this.sanitizeFilename(id)}-${timestamp}`;

      const jsonPath = join(this.config.directory, `${baseName}.json`);
      writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');

      if (html) {
        const htmlPath = join(this.config.directory, `${baseName}.html`);
        writeFileSync(htmlPath, html, 'utf-8');
      }

      this.snapshotCount += 1;
      return true;
    } catch {
      return false;
    }
  }

  getSnapshotCount(): number {
    return this.snapshotCount;
  }

  private countExistingSnapshots(): number {
    if (!existsSync(this.config.directory)) {
      return 0;
    }

    try {
      return readdirSync(this.config.directory).filter((file) =>
        file.endsWith('.json'),
      ).length;
    } catch {
      return 0;
    }
  }

  private sanitizeFilename(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  }
}

export type { ErrorSnapshotData, ErrorSnapshotConfig };
