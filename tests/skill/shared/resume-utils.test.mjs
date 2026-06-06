import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Module under test
import {
  getPendingItems,
  getCompletedIds,
  hasBatchOutput,
  reportProgress,
} from '../../../understand-anything-plugin/skills/shared/resume-utils.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ua-resume-test-'));
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// ── getPendingItems ───────────────────────────────────────────────────────

describe('getPendingItems', () => {
  it('returns all items when no output files exist', () => {
    const items = [
      { id: 1, outputPath: join(tmpDir, 'batch-1.json') },
      { id: 2, outputPath: join(tmpDir, 'batch-2.json') },
      { id: 3, outputPath: join(tmpDir, 'batch-3.json') },
    ];
    const pending = getPendingItems(items);
    expect(pending).toEqual(items);
  });

  it('returns empty array when all output files exist', () => {
    const items = [
      { id: 1, outputPath: join(tmpDir, 'batch-1.json') },
      { id: 2, outputPath: join(tmpDir, 'batch-2.json') },
    ];
    writeFileSync(items[0].outputPath, '{"nodes":[]}');
    writeFileSync(items[1].outputPath, '{"nodes":[]}');
    const pending = getPendingItems(items);
    expect(pending).toEqual([]);
  });

  it('returns only items without output files (partial completion)', () => {
    const items = [
      { id: 1, outputPath: join(tmpDir, 'batch-1.json') },
      { id: 2, outputPath: join(tmpDir, 'batch-2.json') },
      { id: 3, outputPath: join(tmpDir, 'batch-3.json') },
    ];
    writeFileSync(items[0].outputPath, '{"nodes":[]}');
    // batch-2 missing
    writeFileSync(items[2].outputPath, '{"nodes":[]}');
    const pending = getPendingItems(items);
    expect(pending).toEqual([items[1]]);
  });

  it('treats empty files as pending', () => {
    const items = [
      { id: 1, outputPath: join(tmpDir, 'batch-1.json') },
      { id: 2, outputPath: join(tmpDir, 'batch-2.json') },
    ];
    writeFileSync(items[0].outputPath, '{"nodes":[]}');
    writeFileSync(items[1].outputPath, ''); // empty = incomplete
    const pending = getPendingItems(items);
    expect(pending).toEqual([items[1]]);
  });

  it('returns empty array for empty input', () => {
    expect(getPendingItems([])).toEqual([]);
  });
});

// ── getCompletedIds ───────────────────────────────────────────────────────

describe('getCompletedIds', () => {
  it('returns Set of completed item ids', () => {
    const items = [
      { id: 'a', outputPath: join(tmpDir, 'a.json') },
      { id: 'b', outputPath: join(tmpDir, 'b.json') },
      { id: 'c', outputPath: join(tmpDir, 'c.json') },
    ];
    writeFileSync(items[0].outputPath, '{}');
    // b missing
    writeFileSync(items[2].outputPath, '{}');
    const completed = getCompletedIds(items);
    expect(completed).toEqual(new Set(['a', 'c']));
  });

  it('returns empty Set when no files exist', () => {
    const items = [
      { id: 'a', outputPath: join(tmpDir, 'a.json') },
    ];
    expect(getCompletedIds(items)).toEqual(new Set());
  });
});

// ── hasBatchOutput ────────────────────────────────────────────────────────

describe('hasBatchOutput', () => {
  const intermediate = 'intermediate';

  beforeEach(() => {
    mkdirSync(join(tmpDir, intermediate), { recursive: true });
  });

  it('returns true for single-file mode (batch-<i>.json exists and non-empty)', () => {
    writeFileSync(join(tmpDir, intermediate, 'batch-3.json'), '{"nodes":[]}');
    expect(hasBatchOutput(tmpDir, intermediate, 3)).toBe(true);
  });

  it('returns false for single-file mode (file missing)', () => {
    expect(hasBatchOutput(tmpDir, intermediate, 3)).toBe(false);
  });

  it('returns false for single-file mode (file empty)', () => {
    writeFileSync(join(tmpDir, intermediate, 'batch-3.json'), '');
    expect(hasBatchOutput(tmpDir, intermediate, 3)).toBe(false);
  });

  it('returns true for split-file mode (batch-<i>-part-<k>.json exists)', () => {
    writeFileSync(join(tmpDir, intermediate, 'batch-3-part-1.json'), '{"nodes":[]}');
    expect(hasBatchOutput(tmpDir, intermediate, 3)).toBe(true);
  });

  it('returns true when both single and part files exist', () => {
    writeFileSync(join(tmpDir, intermediate, 'batch-3.json'), '{"nodes":[]}');
    writeFileSync(join(tmpDir, intermediate, 'batch-3-part-1.json'), '{"nodes":[]}');
    expect(hasBatchOutput(tmpDir, intermediate, 3)).toBe(true);
  });

  it('returns false when only empty part file exists', () => {
    writeFileSync(join(tmpDir, intermediate, 'batch-3-part-1.json'), '');
    expect(hasBatchOutput(tmpDir, intermediate, 3)).toBe(false);
  });
});

// ── reportProgress ────────────────────────────────────────────────────────

describe('reportProgress', () => {
  it('reports all complete', () => {
    const items = [
      { id: 1, outputPath: join(tmpDir, 'a.json') },
      { id: 2, outputPath: join(tmpDir, 'b.json') },
    ];
    writeFileSync(items[0].outputPath, '{}');
    writeFileSync(items[1].outputPath, '{}');
    const msg = reportProgress(items);
    expect(msg).toContain('2/2');
    expect(msg).toContain('complete');
  });

  it('reports partial progress', () => {
    const items = [
      { id: 1, outputPath: join(tmpDir, 'a.json') },
      { id: 2, outputPath: join(tmpDir, 'b.json') },
      { id: 3, outputPath: join(tmpDir, 'c.json') },
    ];
    writeFileSync(items[0].outputPath, '{}');
    const msg = reportProgress(items);
    expect(msg).toContain('1/3');
    expect(msg).toContain('2');
  });

  it('reports fresh start when no files exist', () => {
    const items = [
      { id: 1, outputPath: join(tmpDir, 'a.json') },
    ];
    const msg = reportProgress(items);
    expect(msg).toContain('0/1');
    expect(msg).toContain('1');
  });
});
