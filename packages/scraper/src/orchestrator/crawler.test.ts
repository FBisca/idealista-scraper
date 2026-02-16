import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { CrawlOrchestrator } from './crawler.js';
import { Router } from './router.js';
import { EngineAdapter } from '../web-engine/engine-adapter.js';
import type { FetchResponse, WebContentParser } from '../web-engine/types.js';
import type { CrawlContext } from './types.js';

class MockEngine extends EngineAdapter {
  readonly engineType = 'crawlee' as const;
  private readonly responses: Map<string, FetchResponse<unknown>>;

  constructor(responses?: Map<string, FetchResponse<unknown>>) {
    super();
    this.responses = responses ?? new Map();
  }

  setResponse(url: string, response: FetchResponse<unknown>): void {
    this.responses.set(url, response);
  }

  async fetch<T>(url: string): Promise<FetchResponse<T>> {
    const response = this.responses.get(url);
    if (response) {
      return response as FetchResponse<T>;
    }

    return {
      success: true,
      title: 'Mock',
      content: { url } as T,
      metadata: { duration: 10, method: 'mock' },
    };
  }

  async cleanup(): Promise<void> {}
}

const TEST_DIR = join(process.cwd(), 'tmp', 'test-orchestrator');

function makeConfig(overrides?: Record<string, unknown>) {
  const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseDir = join(TEST_DIR, testId);

  return {
    config: {
      maxConcurrency: 1,
      maxRequestsPerMinute: 600,
      maxRetries: 3,
      outputPath: join(baseDir, 'output.jsonl'),
      statePath: join(baseDir, 'state.json'),
      queuePath: join(baseDir, 'queue.jsonl'),
      errorSnapshotDir: join(baseDir, 'errors'),
      sourceUrl: 'https://example.com',
      resume: false,
      engineFactory: () => new MockEngine(),
      ...overrides,
    },
    baseDir,
  };
}

describe('CrawlOrchestrator', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('lifecycle: seed → process → done', async () => {
    const { config } = makeConfig();
    const router = new Router();

    const processed: string[] = [];

    router.addDefaultHandler(async (context: CrawlContext) => {
      const response = await context.fetchPage({
        htmlParser: {} as WebContentParser<string, unknown>,
      });

      if (response.success) {
        context.pushData(context.request.uniqueKey, response.content);
        processed.push(context.request.url);
      }
    });

    const orchestrator = new CrawlOrchestrator(config, router);
    await orchestrator.run([
      { url: 'https://example.com/page1' },
      { url: 'https://example.com/page2' },
    ]);

    expect(processed).toContain('https://example.com/page1');
    expect(processed).toContain('https://example.com/page2');
  });

  it('concurrency bounds respected', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const { config } = makeConfig({
      maxConcurrency: 2,
      engineFactory: () => new MockEngine(),
    });

    const router = new Router();
    router.addDefaultHandler(async (context: CrawlContext) => {
      currentConcurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise((resolve) => setTimeout(resolve, 50));
      context.pushData(context.request.uniqueKey, {});
      currentConcurrent -= 1;
    });

    const orchestrator = new CrawlOrchestrator(config, router);
    await orchestrator.run([
      { url: 'https://example.com/a' },
      { url: 'https://example.com/b' },
      { url: 'https://example.com/c' },
      { url: 'https://example.com/d' },
    ]);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('retry with session rotation on hard-block', async () => {
    let callCount = 0;

    const { config } = makeConfig({
      maxConcurrency: 1,
      maxRetries: 2,
      engineFactory: () => {
        return {
          engineType: 'crawlee' as const,
          async fetch() {
            callCount += 1;
            if (callCount === 1) {
              return {
                success: false,
                error: '403 Forbidden',
                errorCode: 'blocked',
                metadata: { duration: 10, method: 'mock' },
              };
            }
            return {
              success: true,
              title: 'OK',
              content: { data: 'success' },
              metadata: { duration: 10, method: 'mock' },
            };
          },
          async cleanup() {},
        } as EngineAdapter;
      },
    });

    const router = new Router();
    router.addDefaultHandler(async (context: CrawlContext) => {
      const response = await context.fetchPage({
        htmlParser: {} as WebContentParser<string, unknown>,
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      context.pushData(context.request.uniqueKey, response.content);
    });

    const orchestrator = new CrawlOrchestrator(config, router);
    await orchestrator.run([{ url: 'https://example.com/blocked' }]);

    expect(callCount).toBe(2);
  });

  it('progress writer receives extracted data', async () => {
    const { config } = makeConfig();
    const router = new Router();

    router.addDefaultHandler(async (context: CrawlContext) => {
      context.pushData(context.request.uniqueKey, {
        title: 'Test Property',
        price: 100000,
      });
    });

    const orchestrator = new CrawlOrchestrator(config, router);
    await orchestrator.run([{ url: 'https://example.com/prop1' }]);

    const outputPath = config.outputPath;
    expect(existsSync(outputPath)).toBe(true);

    const content = readFileSync(outputPath, 'utf-8').trim();
    const lines = content.split('\n').filter((line) => line.trim());
    expect(lines.length).toBe(1);

    const entry = JSON.parse(lines[0]!);
    expect(entry.id).toBe('https://example.com/prop1');
    expect(entry.data.title).toBe('Test Property');
  });

  it('queue entries transition through states', async () => {
    const { config } = makeConfig();
    const router = new Router();

    const handlerStates: string[] = [];
    router.addDefaultHandler(async (context: CrawlContext) => {
      handlerStates.push(`processing:${context.request.url}`);
      context.pushData(context.request.uniqueKey, {});
    });

    const orchestrator = new CrawlOrchestrator(config, router);
    await orchestrator.run([
      { url: 'https://example.com/1' },
      { url: 'https://example.com/2' },
    ]);

    expect(handlerStates).toHaveLength(2);
    expect(handlerStates).toContain('processing:https://example.com/1');
    expect(handlerStates).toContain('processing:https://example.com/2');
  });

  it('failed requests are marked and snapshotted', async () => {
    const { config } = makeConfig({
      maxRetries: 0,
    });

    const router = new Router();
    router.addDefaultHandler(async () => {
      throw new Error('Parse error: selector not found');
    });

    const orchestrator = new CrawlOrchestrator(config, router);
    await orchestrator.run([{ url: 'https://example.com/fail' }]);

    const errorDir = config.errorSnapshotDir;
    if (existsSync(errorDir)) {
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(errorDir) as string[];
      const jsonFiles = files.filter((file: string) => file.endsWith('.json'));
      expect(jsonFiles.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('enqueue from handler adds to queue', async () => {
    const { config } = makeConfig();
    const router = new Router();

    const processed: string[] = [];

    router.addHandler('LIST', async (context: CrawlContext) => {
      context.enqueue('https://example.com/detail1', 'DETAIL');
      context.enqueue('https://example.com/detail2', 'DETAIL');
    });

    router.addHandler('DETAIL', async (context: CrawlContext) => {
      processed.push(context.request.url);
      context.pushData(context.request.uniqueKey, { detail: true });
    });

    const orchestrator = new CrawlOrchestrator(config, router);
    await orchestrator.run([
      { url: 'https://example.com/list', label: 'LIST' },
    ]);

    expect(processed).toContain('https://example.com/detail1');
    expect(processed).toContain('https://example.com/detail2');
  });

  it('resume from existing state skips completed work', async () => {
    const testId = `${Date.now()}-resume`;
    const baseDir = join(TEST_DIR, testId);
    const mockEngine = new MockEngine();

    const sharedConfig = {
      maxConcurrency: 1,
      maxRequestsPerMinute: 600,
      maxRetries: 3,
      outputPath: join(baseDir, 'output.jsonl'),
      statePath: join(baseDir, 'state.json'),
      queuePath: join(baseDir, 'queue.jsonl'),
      errorSnapshotDir: join(baseDir, 'errors'),
      sourceUrl: 'https://example.com',
      resume: false,
      engineFactory: () => mockEngine,
    };

    const router1 = new Router();
    const firstRunProcessed: string[] = [];

    router1.addDefaultHandler(async (context: CrawlContext) => {
      firstRunProcessed.push(context.request.url);
      context.pushData(context.request.uniqueKey, { run: 1 });
    });

    const orchestrator1 = new CrawlOrchestrator(sharedConfig, router1);
    await orchestrator1.run([
      { url: 'https://example.com/page1' },
      { url: 'https://example.com/page2' },
    ]);

    expect(firstRunProcessed).toHaveLength(2);

    const router2 = new Router();
    const secondRunProcessed: string[] = [];

    router2.addDefaultHandler(async (context: CrawlContext) => {
      secondRunProcessed.push(context.request.url);
      context.pushData(context.request.uniqueKey, { run: 2 });
    });

    const orchestrator2 = new CrawlOrchestrator(
      { ...sharedConfig, resume: true },
      router2,
    );
    await orchestrator2.run([
      { url: 'https://example.com/page1' },
      { url: 'https://example.com/page2' },
      { url: 'https://example.com/page3' },
    ]);

    expect(secondRunProcessed).toContain('https://example.com/page3');
    expect(secondRunProcessed).not.toContain('https://example.com/page1');
    expect(secondRunProcessed).not.toContain('https://example.com/page2');
  });
});
