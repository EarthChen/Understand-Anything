import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCheckpoint } from '../../../understand-anything-plugin/skills/shared/checkpoint-writer.mjs';
import { isValidCheckpoint } from '../../../understand-anything-plugin/skills/shared/resume-utils.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ua-checkpoint-test-'));
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('writeCheckpoint', () => {
  it('writes data with _checkpoint.status = complete', () => {
    const p = join(tmpDir, 'out.json');
    writeCheckpoint(p, { nodes: [1, 2, 3] }, 'complete');
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    expect(parsed.nodes).toEqual([1, 2, 3]);
    expect(parsed._checkpoint.status).toBe('complete');
    expect(isValidCheckpoint(p)).toEqual({ valid: true, status: 'complete' });
  });

  it('writes data with _checkpoint.status = degraded and reason', () => {
    const p = join(tmpDir, 'out.json');
    writeCheckpoint(p, { partial: true }, 'degraded', 'LLM schema validation failed');
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    expect(parsed._checkpoint.status).toBe('degraded');
    expect(parsed._checkpoint.reason).toBe('LLM schema validation failed');
    expect(isValidCheckpoint(p)).toEqual({ valid: false, status: 'degraded' });
  });

  it('writes data with _checkpoint.status = failed', () => {
    const p = join(tmpDir, 'out.json');
    writeCheckpoint(p, {}, 'failed', 'API timeout');
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    expect(parsed._checkpoint.status).toBe('failed');
    expect(parsed._checkpoint.reason).toBe('API timeout');
  });

  it('atomic write: no partial file on disk during write', () => {
    const p = join(tmpDir, 'atomic.json');
    writeCheckpoint(p, { big: 'data'.repeat(1000) }, 'complete');
    expect(existsSync(p)).toBe(true);
    const tmpFile = p + '.tmp';
    expect(existsSync(tmpFile)).toBe(false);
  });

  it('overwrites existing file', () => {
    const p = join(tmpDir, 'overwrite.json');
    writeCheckpoint(p, { v: 1 }, 'degraded', 'first');
    writeCheckpoint(p, { v: 2 }, 'complete');
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    expect(parsed.v).toBe(2);
    expect(parsed._checkpoint.status).toBe('complete');
  });

  it('throws on invalid status value', () => {
    const p = join(tmpDir, 'bad.json');
    expect(() => writeCheckpoint(p, {}, 'complet')).toThrow('Invalid checkpoint status');
    expect(() => writeCheckpoint(p, {}, '')).toThrow('Invalid checkpoint status');
    expect(() => writeCheckpoint(p, {}, 'unknown')).toThrow('Invalid checkpoint status');
  });
});
