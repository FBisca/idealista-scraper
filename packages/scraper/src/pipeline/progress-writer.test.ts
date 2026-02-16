import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProgressWriter } from './progress-writer.js';

const TEST_DIR = join(process.cwd(), 'tmp', 'test-progress-writer');
const OUTPUT_PATH = join(TEST_DIR, 'output.jsonl');

function cleanup(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('ProgressWriter', () => {
  beforeEach(() => {
    cleanup();
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('appends and reads entries round-trip', () => {
    const writer = new ProgressWriter<{ name: string }>(OUTPUT_PATH);
    writer.initialize();

    writer.append('id-1', { name: 'first' });
    writer.append('id-2', { name: 'second' });

    const entries = writer.readAll();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: 'id-1', data: { name: 'first' } });
    expect(entries[1]).toMatchObject({ id: 'id-2', data: { name: 'second' } });
    expect(entries[0]?.timestamp).toBeTypeOf('number');
  });

  it('recovers entries from existing tmp file on re-initialize', () => {
    const writer = new ProgressWriter<{ value: number }>(OUTPUT_PATH);
    writer.initialize();
    writer.append('a', { value: 1 });
    writer.append('b', { value: 2 });

    const resumed = new ProgressWriter<{ value: number }>(OUTPUT_PATH);
    resumed.initialize();

    const entries = resumed.readAll();
    expect(entries).toHaveLength(2);
    expect(resumed.getLineCount()).toBe(2);
  });

  it('extracts completed IDs for resume', () => {
    const writer = new ProgressWriter<string>(OUTPUT_PATH);
    writer.initialize();
    writer.append('x', 'data-x');
    writer.append('y', 'data-y');
    writer.append('z', 'data-z');

    const completedIds = writer.readCompletedIds();
    expect(completedIds).toEqual(new Set(['x', 'y', 'z']));
  });

  it('finalize renames tmp to output', () => {
    const writer = new ProgressWriter<string>(OUTPUT_PATH);
    writer.initialize();
    writer.append('item', 'payload');

    expect(existsSync(`${OUTPUT_PATH}.tmp`)).toBe(true);
    expect(existsSync(OUTPUT_PATH)).toBe(false);

    writer.finalize();

    expect(existsSync(`${OUTPUT_PATH}.tmp`)).toBe(false);
    expect(existsSync(OUTPUT_PATH)).toBe(true);

    const content = readFileSync(OUTPUT_PATH, 'utf-8').trim();
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe('item');
  });

  it('handles empty file gracefully', () => {
    const writer = new ProgressWriter<string>(OUTPUT_PATH);
    writer.initialize();

    const entries = writer.readAll();
    expect(entries).toHaveLength(0);

    const ids = writer.readCompletedIds();
    expect(ids.size).toBe(0);
  });

  it('tracks line count correctly', () => {
    const writer = new ProgressWriter<string>(OUTPUT_PATH);
    writer.initialize();
    expect(writer.getLineCount()).toBe(0);

    writer.append('1', 'a');
    expect(writer.getLineCount()).toBe(1);

    writer.append('2', 'b');
    writer.append('3', 'c');
    expect(writer.getLineCount()).toBe(3);
  });

  it('creates directory if it does not exist', () => {
    const nestedPath = join(TEST_DIR, 'deep', 'nested', 'output.jsonl');
    const writer = new ProgressWriter<string>(nestedPath);
    writer.initialize();
    writer.append('nested', 'value');

    const entries = writer.readAll();
    expect(entries).toHaveLength(1);
  });
});
