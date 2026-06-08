# Business Landscape Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the engineering foundation for the Business Landscape project by aligning existing skill infrastructure, validating mobile extraction capabilities, and introducing multi-facet configuration.

**Architecture:** Three parallel workstreams — (1) universal checkpoint/validation infrastructure in `shared/resume-utils.mjs`, consumed by skill-specific changes, (2) a validation-only milestone (M0) that produces a report, and (3) configuration schema extension building on the existing `system.json`.

**Tech Stack:** JavaScript/ESM (resume-utils, config reader), Python (init_config.py, validation scripts), Vitest (unit tests), zod (schema validation)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `understand-anything-plugin/skills/shared/config-reader.mjs` | Cascading config.json reader with defaults |
| `understand-anything-plugin/skills/shared/checkpoint-writer.mjs` | Atomic checkpoint write with status metadata |
| `understand-anything-plugin/skills/understand-business/init_config.py` | Generate default system.json + config.json |
| `tests/skill/shared/config-reader.test.mjs` | Unit tests for config cascading |
| `tests/skill/shared/checkpoint-writer.test.mjs` | Unit tests for checkpoint writer |

### Modified Files

| File | Changes |
|------|---------|
| `understand-anything-plugin/skills/shared/resume-utils.mjs` | Add JSON validity check, three-state checkpoint, updated `getPendingItems` |
| `tests/skill/shared/resume-utils.test.mjs` | Add tests for JSON validity, checkpoint status, backward compat |

---

## Task 1: resume-utils.mjs — Three-State Checkpoint Model

**Files:**
- Modify: `understand-anything-plugin/skills/shared/resume-utils.mjs`
- Modify: `tests/skill/shared/resume-utils.test.mjs`

- [ ] **Step 1: Write failing tests for `isValidCheckpoint`**

Add to `tests/skill/shared/resume-utils.test.mjs`:

```javascript
import {
  getPendingItems,
  getCompletedIds,
  hasBatchOutput,
  reportProgress,
  isValidCheckpoint,
} from '../../../understand-anything-plugin/skills/shared/resume-utils.mjs';

// ── isValidCheckpoint ─────────────────────────────────────────────────────

describe('isValidCheckpoint', () => {
  it('returns complete for file with _checkpoint.status = complete', () => {
    const p = join(tmpDir, 'ok.json');
    writeFileSync(p, JSON.stringify({ data: 1, _checkpoint: { status: 'complete' } }));
    expect(isValidCheckpoint(p)).toEqual({ valid: true, status: 'complete' });
  });

  it('returns degraded for file with _checkpoint.status = degraded', () => {
    const p = join(tmpDir, 'deg.json');
    writeFileSync(p, JSON.stringify({ data: 1, _checkpoint: { status: 'degraded', reason: 'LLM failed' } }));
    expect(isValidCheckpoint(p)).toEqual({ valid: false, status: 'degraded' });
  });

  it('returns failed for file with _checkpoint.status = failed', () => {
    const p = join(tmpDir, 'fail.json');
    writeFileSync(p, JSON.stringify({ _checkpoint: { status: 'failed', reason: 'timeout' } }));
    expect(isValidCheckpoint(p)).toEqual({ valid: false, status: 'failed' });
  });

  it('treats legacy files without _checkpoint as complete (backward compat)', () => {
    const p = join(tmpDir, 'legacy.json');
    writeFileSync(p, JSON.stringify({ nodes: [], edges: [] }));
    expect(isValidCheckpoint(p)).toEqual({ valid: true, status: 'complete' });
  });

  it('returns corrupted for truncated JSON', () => {
    const p = join(tmpDir, 'truncated.json');
    writeFileSync(p, '{"nodes": [{"id": "n1"');
    expect(isValidCheckpoint(p)).toEqual({ valid: false, status: 'corrupted' });
  });

  it('returns empty for empty file', () => {
    const p = join(tmpDir, 'empty.json');
    writeFileSync(p, '');
    expect(isValidCheckpoint(p)).toEqual({ valid: false, status: 'empty' });
  });

  it('returns corrupted for missing file', () => {
    expect(isValidCheckpoint(join(tmpDir, 'missing.json'))).toEqual({ valid: false, status: 'corrupted' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/skill/shared/resume-utils.test.mjs`
Expected: FAIL — `isValidCheckpoint` is not exported from resume-utils.mjs

- [ ] **Step 3: Implement `isValidCheckpoint` in resume-utils.mjs**

Add to `understand-anything-plugin/skills/shared/resume-utils.mjs`:

```javascript
import { readFileSync } from 'node:fs';

/**
 * Check if a checkpoint file is valid and determine its status.
 * @param {string} filePath
 * @returns {{ valid: boolean, status: 'complete'|'degraded'|'failed'|'corrupted'|'empty' }}
 */
export function isValidCheckpoint(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    if (!content.trim()) return { valid: false, status: 'empty' };
    const parsed = JSON.parse(content);
    const checkpoint = parsed._checkpoint;
    if (checkpoint?.status === 'complete') return { valid: true, status: 'complete' };
    if (checkpoint?.status === 'degraded') return { valid: false, status: 'degraded' };
    if (checkpoint?.status === 'failed') return { valid: false, status: 'failed' };
    return { valid: true, status: 'complete' };
  } catch {
    return { valid: false, status: 'corrupted' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/skill/shared/resume-utils.test.mjs`
Expected: All `isValidCheckpoint` tests PASS. Existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/shared/resume-utils.mjs tests/skill/shared/resume-utils.test.mjs
git commit -m "feat(resume-utils): add isValidCheckpoint with three-state model"
```

---

## Task 2: resume-utils.mjs — Update getPendingItems to Use Checkpoint Status

**Files:**
- Modify: `understand-anything-plugin/skills/shared/resume-utils.mjs`
- Modify: `tests/skill/shared/resume-utils.test.mjs`

- [ ] **Step 1: Write failing tests for updated `getPendingItems`**

Add new describe block in `tests/skill/shared/resume-utils.test.mjs`:

```javascript
describe('getPendingItems — checkpoint-aware', () => {
  it('skips items with _checkpoint.status = complete', () => {
    const items = [
      { id: 1, outputPath: join(tmpDir, 'a.json') },
      { id: 2, outputPath: join(tmpDir, 'b.json') },
    ];
    writeFileSync(items[0].outputPath, JSON.stringify({ _checkpoint: { status: 'complete' } }));
    writeFileSync(items[1].outputPath, JSON.stringify({ _checkpoint: { status: 'complete' } }));
    expect(getPendingItems(items)).toEqual([]);
  });

  it('returns items with _checkpoint.status = degraded', () => {
    const items = [
      { id: 1, outputPath: join(tmpDir, 'a.json') },
      { id: 2, outputPath: join(tmpDir, 'b.json') },
    ];
    writeFileSync(items[0].outputPath, JSON.stringify({ _checkpoint: { status: 'complete' } }));
    writeFileSync(items[1].outputPath, JSON.stringify({ _checkpoint: { status: 'degraded', reason: 'LLM failed' } }));
    expect(getPendingItems(items)).toEqual([items[1]]);
  });

  it('returns items with truncated JSON', () => {
    const items = [
      { id: 1, outputPath: join(tmpDir, 'a.json') },
    ];
    writeFileSync(items[0].outputPath, '{"nodes":[');
    expect(getPendingItems(items)).toEqual([items[0]]);
  });

  it('backward compat: legacy files without _checkpoint are treated as complete', () => {
    const items = [
      { id: 1, outputPath: join(tmpDir, 'a.json') },
    ];
    writeFileSync(items[0].outputPath, JSON.stringify({ nodes: [] }));
    expect(getPendingItems(items)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/skill/shared/resume-utils.test.mjs`
Expected: New "checkpoint-aware" tests fail because `getPendingItems` still uses simple size check.

- [ ] **Step 3: Update `getPendingItems` implementation**

Replace the current `getPendingItems` in `resume-utils.mjs`:

```javascript
export function getPendingItems(allItems) {
  return allItems.filter(item => {
    const result = isValidCheckpoint(item.outputPath);
    return !result.valid;
  });
}
```

- [ ] **Step 4: Update `getCompletedIds` to match**

Replace in `resume-utils.mjs`:

```javascript
export function getCompletedIds(allItems) {
  const ids = new Set();
  for (const item of allItems) {
    const result = isValidCheckpoint(item.outputPath);
    if (result.valid) ids.add(item.id);
  }
  return ids;
}
```

- [ ] **Step 5: Run all tests**

Run: `pnpm test -- tests/skill/shared/resume-utils.test.mjs`
Expected: All tests PASS (both new checkpoint-aware tests and existing tests).

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/skills/shared/resume-utils.mjs tests/skill/shared/resume-utils.test.mjs
git commit -m "feat(resume-utils): update getPendingItems/getCompletedIds to use checkpoint status"
```

---

## Task 3: Atomic Checkpoint Writer

**Files:**
- Create: `understand-anything-plugin/skills/shared/checkpoint-writer.mjs`
- Create: `tests/skill/shared/checkpoint-writer.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/skill/shared/checkpoint-writer.test.mjs`:

```javascript
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/skill/shared/checkpoint-writer.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement checkpoint-writer.mjs**

Create `understand-anything-plugin/skills/shared/checkpoint-writer.mjs`:

```javascript
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Write data to a checkpoint file with status metadata.
 * Uses atomic write: write to temp → rename to final path.
 *
 * @param {string} filePath - Final output path
 * @param {object} data - JSON-serializable data
 * @param {'complete'|'degraded'|'failed'} status - Checkpoint status
 * @param {string} [reason] - Reason for degraded/failed status
 */
export function writeCheckpoint(filePath, data, status, reason) {
  const output = {
    ...data,
    _checkpoint: { status, ...(reason ? { reason } : {}) },
  };
  const jsonStr = JSON.stringify(output, null, 2);
  const tmpPath = filePath + '.tmp';
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(tmpPath, jsonStr, 'utf-8');
  JSON.parse(jsonStr);
  renameSync(tmpPath, filePath);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/skill/shared/checkpoint-writer.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/shared/checkpoint-writer.mjs tests/skill/shared/checkpoint-writer.test.mjs
git commit -m "feat(shared): add atomic checkpoint writer with status metadata"
```

---

## Task 4: Cascading Config Reader

**Files:**
- Create: `understand-anything-plugin/skills/shared/config-reader.mjs`
- Create: `tests/skill/shared/config-reader.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/skill/shared/config-reader.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, CONFIG_DEFAULTS } from '../../../understand-anything-plugin/skills/shared/config-reader.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ua-config-test-'));
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('readConfig', () => {
  it('returns defaults when no config files exist', () => {
    const config = readConfig({
      projectRoot: tmpDir,
      facetPath: join(tmpDir, 'server'),
      servicePath: join(tmpDir, 'server', 'order-service'),
    });
    expect(config).toEqual(CONFIG_DEFAULTS);
  });

  it('reads Level 1 config', () => {
    mkdirSync(join(tmpDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.understand-anything', 'config.json'),
      JSON.stringify({ outputLanguage: 'en' })
    );
    const config = readConfig({
      projectRoot: tmpDir,
      facetPath: join(tmpDir, 'server'),
      servicePath: join(tmpDir, 'server', 'order-service'),
    });
    expect(config.outputLanguage).toBe('en');
    expect(config.autoUpdate).toBe(false);
  });

  it('Level 3 overrides Level 1', () => {
    mkdirSync(join(tmpDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.understand-anything', 'config.json'),
      JSON.stringify({ outputLanguage: 'en', autoUpdate: true })
    );
    const svcDir = join(tmpDir, 'server', 'order-service');
    mkdirSync(join(svcDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(svcDir, '.understand-anything', 'config.json'),
      JSON.stringify({ outputLanguage: 'zh-CN' })
    );
    const config = readConfig({
      projectRoot: tmpDir,
      facetPath: join(tmpDir, 'server'),
      servicePath: svcDir,
    });
    expect(config.outputLanguage).toBe('zh-CN');
    expect(config.autoUpdate).toBe(true);
  });

  it('Level 2 overrides Level 1, Level 3 overrides Level 2', () => {
    mkdirSync(join(tmpDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.understand-anything', 'config.json'),
      JSON.stringify({ outputLanguage: 'en' })
    );
    const facetDir = join(tmpDir, 'server');
    mkdirSync(join(facetDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(facetDir, '.understand-anything', 'config.json'),
      JSON.stringify({ outputLanguage: 'ja', rpcAnnotations: ['@DubboService'] })
    );
    const svcDir = join(tmpDir, 'server', 'order-service');
    mkdirSync(join(svcDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(svcDir, '.understand-anything', 'config.json'),
      JSON.stringify({ outputLanguage: 'zh-CN' })
    );
    const config = readConfig({
      projectRoot: tmpDir,
      facetPath: facetDir,
      servicePath: svcDir,
    });
    expect(config.outputLanguage).toBe('zh-CN');
    expect(config.rpcAnnotations).toEqual(['@DubboService']);
  });

  it('empty array overrides parent (explicit empty is defined)', () => {
    mkdirSync(join(tmpDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.understand-anything', 'config.json'),
      JSON.stringify({ excludeServices: ['legacy-*'] })
    );
    const svcDir = join(tmpDir, 'server', 'order-service');
    mkdirSync(join(svcDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(svcDir, '.understand-anything', 'config.json'),
      JSON.stringify({ excludeServices: [] })
    );
    const config = readConfig({
      projectRoot: tmpDir,
      facetPath: join(tmpDir, 'server'),
      servicePath: svcDir,
    });
    expect(config.excludeServices).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/skill/shared/config-reader.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement config-reader.mjs**

Create `understand-anything-plugin/skills/shared/config-reader.mjs`:

```javascript
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONFIG_DEFAULTS = {
  outputLanguage: 'zh-CN',
  autoUpdate: false,
  excludeServices: [],
  rpcAnnotations: [],
  apiBaseUrl: '',
  protocolType: 'rest',
};

/**
 * Read cascading config.json from Level 1 → Level 2 → Level 3.
 * Later levels override earlier ones. Missing files are skipped.
 * A field present in a config file (even if empty string/array) counts as defined.
 *
 * @param {{ projectRoot: string, facetPath?: string, servicePath?: string }} paths
 * @returns {object} Merged configuration with defaults
 */
export function readConfig({ projectRoot, facetPath, servicePath }) {
  const configPaths = [
    join(projectRoot, '.understand-anything', 'config.json'),
    facetPath ? join(facetPath, '.understand-anything', 'config.json') : null,
    servicePath ? join(servicePath, '.understand-anything', 'config.json') : null,
  ].filter(Boolean);

  let merged = { ...CONFIG_DEFAULTS };

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) continue;
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      for (const [key, value] of Object.entries(parsed)) {
        if (key in CONFIG_DEFAULTS) {
          merged[key] = value;
        }
      }
    } catch {
      // Malformed config file — skip silently, use parent values
    }
  }

  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/skill/shared/config-reader.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/shared/config-reader.mjs tests/skill/shared/config-reader.test.mjs
git commit -m "feat(shared): add cascading config reader with Level 1/2/3 override"
```

---

## Task 5: system.json Schema Extension

**Files:**
- Modify: `understand-anything-plugin/skills/shared/config-reader.mjs` (add `readSystemConfig`)
- Modify: `tests/skill/shared/config-reader.test.mjs` (add system.json tests)

- [ ] **Step 1: Write failing tests for `readSystemConfig`**

Add to `tests/skill/shared/config-reader.test.mjs`:

```javascript
import { readConfig, readSystemConfig, CONFIG_DEFAULTS } from '../../../understand-anything-plugin/skills/shared/config-reader.mjs';

describe('readSystemConfig', () => {
  it('returns null when system.json does not exist', () => {
    expect(readSystemConfig(tmpDir)).toBeNull();
  });

  it('reads system.json with facets', () => {
    mkdirSync(join(tmpDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.understand-anything', 'system.json'),
      JSON.stringify({
        name: 'test-project',
        facets: [
          { id: 'server', path: 'server/', type: 'backend' },
          { id: 'client', path: 'client/', type: 'mobile', subPaths: ['android/', 'ios/'] },
        ],
      })
    );
    const sys = readSystemConfig(tmpDir);
    expect(sys.name).toBe('test-project');
    expect(sys.facets).toHaveLength(2);
    expect(sys.facets[0]).toEqual({ id: 'server', path: 'server/', type: 'backend' });
    expect(sys.facets[1].subPaths).toEqual(['android/', 'ios/']);
  });

  it('backward compat: existing system.json without facets returns empty facets', () => {
    mkdirSync(join(tmpDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.understand-anything', 'system.json'),
      JSON.stringify({ name: 'old-project', discovery: { mode: 'auto' } })
    );
    const sys = readSystemConfig(tmpDir);
    expect(sys.name).toBe('old-project');
    expect(sys.facets).toEqual([]);
    expect(sys.discovery).toEqual({ mode: 'auto' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/skill/shared/config-reader.test.mjs`
Expected: FAIL — `readSystemConfig` is not exported

- [ ] **Step 3: Implement `readSystemConfig`**

Add to `understand-anything-plugin/skills/shared/config-reader.mjs`:

```javascript
/**
 * Read system.json from project root. Returns null if not found.
 * Adds default empty facets[] if field is missing (backward compat).
 *
 * @param {string} projectRoot
 * @returns {object|null}
 */
export function readSystemConfig(projectRoot) {
  const systemPath = join(projectRoot, '.understand-anything', 'system.json');
  if (!existsSync(systemPath)) return null;
  try {
    const raw = readFileSync(systemPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.facets) parsed.facets = [];
    return parsed;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/skill/shared/config-reader.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/shared/config-reader.mjs tests/skill/shared/config-reader.test.mjs
git commit -m "feat(config): add readSystemConfig with facets support and backward compat"
```

---

## Task 6: init_config.py Script

**Files:**
- Create: `understand-anything-plugin/skills/understand-business/init_config.py`

- [ ] **Step 1: Write the script**

Create `understand-anything-plugin/skills/understand-business/init_config.py`:

```python
#!/usr/bin/env python3
"""Generate default system.json and config.json for a project.

Usage: python3 init_config.py [project-root]
       Defaults to current directory if project-root is omitted.
"""

import json
import os
import sys
from pathlib import Path


def detect_facets(project_root: Path) -> list[dict]:
    """Scan project root for recognizable facet patterns."""
    facets = []
    for d in sorted(project_root.iterdir()):
        if not d.is_dir() or d.name.startswith('.'):
            continue
        ua_dir = d / '.understand-anything'
        if not ua_dir.exists():
            continue
        kg = ua_dir / 'knowledge-graph.json'
        if not kg.exists():
            continue
        facet_type = _guess_type(d)
        facet = {'id': d.name, 'path': f'{d.name}/', 'type': facet_type}
        sub_paths = _detect_sub_paths(d)
        if sub_paths:
            facet['subPaths'] = sub_paths
        facets.append(facet)
    return facets


def _guess_type(d: Path) -> str:
    """Guess facet type from directory contents."""
    names = {f.name.lower() for f in d.iterdir() if f.is_file()}
    if any(n in names for n in ('build.gradle', 'build.gradle.kts', 'androidmanifest.xml')):
        return 'mobile'
    if any(n in names for n in ('package.json', 'tsconfig.json', 'vite.config.ts')):
        return 'frontend'
    if any(n in names for n in ('pom.xml', 'go.mod', 'requirements.txt', 'cargo.toml')):
        return 'backend'
    return 'backend'


def _detect_sub_paths(d: Path) -> list[str]:
    """Detect sub-platform directories for mobile facets."""
    known = ['android', 'ios', 'flutter', 'react-native']
    found = []
    for sub in sorted(d.iterdir()):
        if sub.is_dir() and sub.name.lower() in known:
            found.append(f'{sub.name}/')
    return found


def main():
    project_root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    ua_dir = project_root / '.understand-anything'
    ua_dir.mkdir(parents=True, exist_ok=True)

    system_path = ua_dir / 'system.json'
    config_path = ua_dir / 'config.json'

    if system_path.exists():
        print(f'system.json already exists at {system_path}, skipping.')
    else:
        facets = detect_facets(project_root)
        system = {
            'name': project_root.name,
            'description': '',
            'discovery': {'mode': 'manual'},
            'facets': facets,
        }
        system_path.write_text(json.dumps(system, indent=2, ensure_ascii=False) + '\n')
        print(f'Created {system_path} with {len(facets)} facet(s) detected.')

    if config_path.exists():
        print(f'config.json already exists at {config_path}, skipping.')
    else:
        config = {
            'outputLanguage': 'zh-CN',
            'autoUpdate': False,
            'excludeServices': [],
            'rpcAnnotations': [],
            'apiBaseUrl': '',
            'protocolType': 'rest',
        }
        config_path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + '\n')
        print(f'Created {config_path}')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Test manually**

Run: `python3 understand-anything-plugin/skills/understand-business/init_config.py /tmp/test-project`
Expected: Creates `.understand-anything/system.json` and `.understand-anything/config.json` in the test directory.

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand-business/init_config.py
git commit -m "feat(config): add init_config.py for generating default system.json and config.json"
```

---

## Task 7: /understand-knowledge Skill Modifications

**Files:**
- Modify: `understand-anything-plugin/skills/understand-knowledge/SKILL.md`

Note: These are agent prompt/instruction changes. The underlying infrastructure (resume-utils, checkpoint-writer) was built in Tasks 1-3.

- [ ] **Step 1: Add `--full` flag handling to SKILL.md**

In the skill's instruction section, add:
- When `--full` is specified: delete `intermediate/` directory before processing
- When not specified (default): use `getPendingItems()` to skip completed checkpoints

- [ ] **Step 2: Update intermediate/ cleanup behavior**

Change: remove the post-success `rm -rf intermediate/` step.
Add: `--clean` optional flag that explicitly removes intermediate/ after success.
Default: preserve intermediate/ directory.

- [ ] **Step 3: Add enhanced validation instructions**

Add to SKILL.md's post-processing phase:
- Run `validate-graph.mjs` (existing) with zod schema check
- Add content non-empty check: all node `summary` fields are non-empty strings
- Add edge type validity check: all edge `type` values are in the allowed set

- [ ] **Step 4: Verify manually**

Run `/understand-knowledge` on a test repo. Verify:
- `--full` clears intermediate/ and regenerates
- Default run resumes from checkpoint
- Validation catches intentionally bad data

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-knowledge/
git commit -m "feat(understand-knowledge): add --full flag, preserve intermediate, enhance validation"
```

---

## Task 8: /understand-onboard Skill Restructuring

**Files:**
- Modify: `understand-anything-plugin/skills/understand-onboard/SKILL.md`
- Create: `understand-anything-plugin/skills/understand-onboard/scripts/extract-structure.py`

- [ ] **Step 1: Create deterministic extraction script**

Create `understand-anything-plugin/skills/understand-onboard/scripts/extract-structure.py`:

```python
#!/usr/bin/env python3
"""Extract structured data from knowledge-graph.json for onboarding generation.

Usage: python3 extract-structure.py <kg-path> <output-path>
"""

import json
import sys
from collections import Counter
from pathlib import Path


def extract(kg_path: str) -> dict:
    with open(kg_path) as f:
        kg = json.load(f)

    nodes = kg.get('nodes', [])
    edges = kg.get('edges', [])

    node_types = Counter(n.get('type', 'unknown') for n in nodes)
    entry_points = [n for n in nodes if n.get('type') == 'endpoint']
    layers = sorted(set(n.get('layer', 'unknown') for n in nodes))

    return {
        'totalNodes': len(nodes),
        'totalEdges': len(edges),
        'nodesByType': dict(node_types),
        'layers': layers,
        'entryPointCount': len(entry_points),
        'topEntryPoints': [
            {'id': n['id'], 'label': n.get('label', n['id'])}
            for n in entry_points[:10]
        ],
    }


def main():
    if len(sys.argv) < 3:
        print('Usage: python3 extract-structure.py <kg-path> <output-path>', file=sys.stderr)
        sys.exit(1)
    kg_path, output_path = sys.argv[1], sys.argv[2]
    result = extract(kg_path)
    Path(output_path).write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    print(f'Extracted structure: {result["totalNodes"]} nodes, {result["totalEdges"]} edges')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Update SKILL.md with new phase structure**

Restructure the skill to:
- Phase 1: Run `extract-structure.py` → `structured-data.json`
- Phase 2: LLM generates onboarding doc using structured-data.json as input
- Phase 3: Validate output markdown structure (required sections: Overview, Architecture, Key Components, Getting Started)

- [ ] **Step 3: Test manually**

Run on a test repo with existing knowledge-graph.json. Verify structured-data.json output is sensible.

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/skills/understand-onboard/
git commit -m "feat(understand-onboard): split into deterministic extraction + LLM generation + validation"
```

---

## Task 9: /understand-diff Schema Validation

**Files:**
- Modify: `understand-anything-plugin/skills/understand-diff/SKILL.md`

- [ ] **Step 1: Add validation step to SKILL.md**

Add post-LLM validation to the skill instructions:
- Parse LLM output as JSON
- Verify top-level structure has `changes` (array), `summary` (string), `risk` (string)
- Verify each change has `file` (string), `type` (one of "added"|"modified"|"deleted"), `impact` (string)
- If validation fails: re-prompt LLM with error details (max 2 retries)

- [ ] **Step 2: Commit**

```bash
git add understand-anything-plugin/skills/understand-diff/
git commit -m "feat(understand-diff): add LLM output schema validation"
```

---

## Task 10: /understand Phase 3-6 Checkpoint

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`

- [ ] **Step 1: Add checkpoint writing to Phase 3-6**

Update SKILL.md instructions for each phase (assemble-review, layers, tour, review):
- After each phase completes, write output to `intermediate/phase-{N}-{name}.json` using `writeCheckpoint()`
- On skill startup, check for existing phase checkpoints and skip completed phases
- `--full` clears all intermediate/ files including phase checkpoints

- [ ] **Step 2: Verify manually**

Run `/understand` on a test repo. Interrupt after Phase 4. Re-run without --full. Verify Phases 3-4 are skipped.

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand/
git commit -m "feat(understand): add Phase 3-6 checkpoint for resume support"
```

---

## Task 11: M0 Validation — Mobile API Call Extraction

**Files:**
- No code changes. This is a validation task.

- [ ] **Step 1: Select benchmark repositories**

Choose internal Android + iOS repositories. Document: repository name, size (files/LOC), primary language, HTTP client library used (e.g., Retrofit, Alamofire, URLSession).

- [ ] **Step 2: Run /understand on Android benchmark**

Run: `/understand --full` on the Android benchmark repository.
Document: total nodes extracted, API call type nodes count, sample API call nodes (3-5 examples).

- [ ] **Step 3: Run /understand on iOS benchmark**

Run: `/understand --full` on the iOS benchmark repository.
Document: total nodes extracted, API call type nodes count, sample API call nodes (3-5 examples).

- [ ] **Step 4: Assess Go/No-Go**

Evaluate against criteria:
- API call nodes ≥ 10 (combined)?
- Nodes contain valid URL path or method name?
- tree-sitter parse coverage ≥ 80%?

- [ ] **Step 5: Write validation report**

Create `docs/superpowers/reports/2026-06-XX-m0-mobile-validation.md` with:
- Benchmark repo statistics
- API call extraction results
- Go/No-Go decision
- If No-Go: Plan B details (LLM fallback implementation timeline)

- [ ] **Step 6: Commit report**

```bash
git add docs/superpowers/reports/
git commit -m "docs: M0 mobile capability validation report"
```

---

## Task 12: Regression Test — Existing Backend Output

**Files:**
- No new files. Validation only.

- [ ] **Step 1: Run modified skills on existing backend repo**

Run the updated `/understand-knowledge` and `/understand` on an existing backend benchmark repository that has previous output.

- [ ] **Step 2: Diff output with previous version**

Compare new output (knowledge-graph.json, intermediate files) with the previous version. Verify:
- No nodes lost
- No edges lost
- Summary quality unchanged
- New checkpoint metadata (`_checkpoint` field) added without breaking existing structure

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 4: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address regression issues from resume-utils upgrade"
```

---

## Summary

| Task | Milestone | Type | Estimated Time |
|------|-----------|------|---------------|
| Task 1: isValidCheckpoint | M-1 | Code (TDD) | 15 min |
| Task 2: Updated getPendingItems | M-1 | Code (TDD) | 15 min |
| Task 3: Checkpoint Writer | M-1 | Code (TDD) | 15 min |
| Task 4: Config Reader | M0.5 | Code (TDD) | 20 min |
| Task 5: system.json Extension | M0.5 | Code (TDD) | 15 min |
| Task 6: init_config.py | M0.5 | Script | 15 min |
| Task 7: /understand-knowledge | M-1 | Skill Modification | 20 min |
| Task 8: /understand-onboard | M-1 | Skill Modification | 25 min |
| Task 9: /understand-diff | M-1 | Skill Modification | 10 min |
| Task 10: /understand Phase 3-6 | M-1 | Skill Modification | 15 min |
| Task 11: M0 Validation | M0 | Validation | 60 min |
| Task 12: Regression Test | M-1 | Validation | 30 min |
| **Total** | | | **~4 hours** |

**Dependency graph:**
- Tasks 1-3 (shared infra) → Tasks 7-10 (skill modifications) → Task 12 (regression)
- Tasks 4-6 (config) can run in parallel with Tasks 1-3
- Task 11 (M0 validation) can run in parallel with all other tasks
