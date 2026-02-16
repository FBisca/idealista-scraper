import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CrawlState } from './crawl-state.js';

const TEST_DIR = join(process.cwd(), 'tmp', 'test-crawl-state');
const STATE_PATH = join(TEST_DIR, 'crawl-state.json');
const SOURCE_URL = 'https://www.idealista.com/venta-viviendas/madrid/';

function cleanup(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('CrawlState', () => {
  beforeEach(() => {
    cleanup();
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('save and load round-trip', () => {
    const state = new CrawlState(STATE_PATH, SOURCE_URL);
    state.addDiscoveredIds(['a', 'b', 'c']);
    state.markCompleted('a');
    state.markFailed('b');
    state.setLastListPage(3);
    state.save();

    const loaded = new CrawlState(STATE_PATH, SOURCE_URL);
    const resumed = loaded.load();

    expect(resumed).toBe(true);
    expect(loaded.discoveredIds).toEqual(['a', 'b', 'c']);
    expect(loaded.completedIds).toEqual(['a']);
    expect(loaded.failedIds).toEqual(['b']);
    expect(loaded.lastListPage).toBe(3);
  });

  it('pendingIds = discovered minus completed minus failed', () => {
    const state = new CrawlState(STATE_PATH, SOURCE_URL);
    state.addDiscoveredIds(['1', '2', '3', '4', '5']);
    state.markCompleted('1');
    state.markCompleted('3');
    state.markFailed('5');

    expect(state.pendingIds).toEqual(['2', '4']);
  });

  it('addDiscoveredIds deduplicates', () => {
    const state = new CrawlState(STATE_PATH, SOURCE_URL);
    state.addDiscoveredIds(['a', 'b']);
    state.addDiscoveredIds(['b', 'c']);

    expect(state.discoveredIds).toEqual(['a', 'b', 'c']);
  });

  it('load returns false for mismatched source URL', () => {
    const state = new CrawlState(STATE_PATH, SOURCE_URL);
    state.addDiscoveredIds(['x']);
    state.save();

    const different = new CrawlState(STATE_PATH, 'https://other.com/');
    const resumed = different.load();

    expect(resumed).toBe(false);
  });

  it('cleanup removes state file', () => {
    const state = new CrawlState(STATE_PATH, SOURCE_URL);
    state.save();

    expect(existsSync(STATE_PATH)).toBe(true);

    state.cleanup();
    expect(existsSync(STATE_PATH)).toBe(false);
  });

  it('setLastListPage persists correctly', () => {
    const state = new CrawlState(STATE_PATH, SOURCE_URL);
    state.setLastListPage(7);
    state.save();

    const loaded = new CrawlState(STATE_PATH, SOURCE_URL);
    loaded.load();

    expect(loaded.lastListPage).toBe(7);
  });

  it('load returns false when file does not exist', () => {
    const state = new CrawlState(STATE_PATH, SOURCE_URL);
    expect(state.load()).toBe(false);
  });
});
