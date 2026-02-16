import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  ErrorSnapshotWriter,
  type ErrorSnapshotData,
} from './error-snapshot.js';

const TEST_DIR = join(process.cwd(), 'tmp', 'test-error-snapshots');

function cleanup(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

function makeSnapshotData(
  overrides?: Partial<ErrorSnapshotData>,
): ErrorSnapshotData {
  return {
    url: 'https://example.com/page',
    statusCode: 403,
    errorMessage: 'Forbidden',
    errorClass: 'hard-block',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ErrorSnapshotWriter', () => {
  beforeEach(() => {
    cleanup();
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('creates JSON file with expected fields', () => {
    const writer = new ErrorSnapshotWriter({ directory: TEST_DIR });
    writer.initialize();

    const data = makeSnapshotData({ captchaSelector: 'cloudflare-challenge' });
    writer.write('test-id', data);

    const files = readdirSync(TEST_DIR).filter((file) =>
      file.endsWith('.json'),
    );
    expect(files).toHaveLength(1);

    const content = JSON.parse(
      readFileSync(join(TEST_DIR, files[0]!), 'utf-8'),
    );
    expect(content.url).toBe('https://example.com/page');
    expect(content.statusCode).toBe(403);
    expect(content.errorMessage).toBe('Forbidden');
    expect(content.errorClass).toBe('hard-block');
    expect(content.captchaSelector).toBe('cloudflare-challenge');
  });

  it('writes HTML companion file when HTML provided', () => {
    const writer = new ErrorSnapshotWriter({ directory: TEST_DIR });
    writer.initialize();

    writer.write(
      'page-1',
      makeSnapshotData(),
      '<html><body>Blocked</body></html>',
    );

    const htmlFiles = readdirSync(TEST_DIR).filter((f) => f.endsWith('.html'));
    expect(htmlFiles).toHaveLength(1);

    const html = readFileSync(join(TEST_DIR, htmlFiles[0]!), 'utf-8');
    expect(html).toContain('Blocked');
  });

  it('enforces cap - 101st snapshot is not written', () => {
    const writer = new ErrorSnapshotWriter({
      directory: TEST_DIR,
      maxSnapshots: 5,
    });
    writer.initialize();

    for (let index = 0; index < 6; index++) {
      writer.write(`item-${index}`, makeSnapshotData());
    }

    const files = readdirSync(TEST_DIR).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(5);
    expect(writer.getSnapshotCount()).toBe(5);
  });

  it('auto-creates directory', () => {
    const nestedDir = join(TEST_DIR, 'deep', 'nested');
    const writer = new ErrorSnapshotWriter({ directory: nestedDir });
    writer.initialize();

    writer.write('auto', makeSnapshotData());

    expect(existsSync(nestedDir)).toBe(true);
    const files = readdirSync(nestedDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
  });

  it('handles write errors gracefully', () => {
    const writer = new ErrorSnapshotWriter({
      directory: '/dev/null/impossible-path',
    });

    const result = writer.write('fail', makeSnapshotData());
    expect(result).toBe(false);
  });
});
