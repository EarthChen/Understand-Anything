import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * RED-phase tests for new compute-batches.mjs features:
 *   1. --exclude-hubs: remove high-degree hub files from the Louvain graph
 *   2. --max-dirs-per-batch: split batches that span too many directories
 *   3. per-batch intra-ratio % in --dry-run output
 *   4. diagnostic output for hub-files count and mixed-dir batch count
 *
 * All tests MUST FAIL against the current code because these features and
 * their corresponding CLI flags / diagnostic lines do not exist yet.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../../understand-anything-plugin/skills/understand/compute-batches.mjs');
const FIXTURES = resolve(__dirname, 'fixtures');

function runScript(projectRoot, extraArgs = []) {
  return spawnSync('node', [SCRIPT, projectRoot, ...extraArgs], {
    encoding: 'utf-8',
  });
}

function setupProject(fixtureName) {
  const root = mkdtempSync(join(tmpdir(), 'ua-cb-feat-'));
  mkdirSync(join(root, '.understand-anything', 'intermediate'), { recursive: true });
  const fixturePath = join(FIXTURES, fixtureName);
  const dest = join(root, '.understand-anything', 'intermediate', 'scan-result.json');
  writeFileSync(dest, readFileSync(fixturePath, 'utf-8'));
  return root;
}

function readBatches(projectRoot) {
  const p = join(projectRoot, '.understand-anything', 'intermediate', 'batches.json');
  return JSON.parse(readFileSync(p, 'utf-8'));
}

// ── Test Group 1: --exclude-hubs ──────────────────────────────────────────────

describe('compute-batches.mjs — --exclude-hubs', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('excludes hub files from Louvain and produces separate clusters', () => {
    root = setupProject('scan-result-hub.json');
    // --exclude-hubs=50 means: any file with graph degree >= 50 is excluded
    // from the Louvain input graph. src/shared/index.ts has degree 50
    // (48 inbound from auth/payments + 2 outbound), so it gets removed.
    // Without the hub bridging them, auth and payments form separate communities.
    const result = runScript(root, ['--exclude-hubs=50']);
    expect(result.status).toBe(0);

    const batches = readBatches(root);
    const allPaths = batches.batches.flatMap(b => b.files.map(f => f.path));

    // The hub file must still appear somewhere (assigned to one cluster)
    expect(allPaths).toContain('src/shared/index.ts');

    // auth files and payments files must be in DIFFERENT batches
    const authBatch = batches.batches.find(b =>
      b.files.some(f => f.path === 'src/auth/auth0.ts'));
    const payBatch = batches.batches.find(b =>
      b.files.some(f => f.path === 'src/payments/pay0.ts'));
    expect(authBatch).toBeDefined();
    expect(payBatch).toBeDefined();
    expect(authBatch.batchIndex).not.toBe(payBatch.batchIndex);
  });

  it('does not exclude files below the hub threshold', () => {
    root = setupProject('scan-result-hub.json');
    // Without --exclude-hubs the hub stays in the graph, connecting both
    // clusters. Louvain should merge them into one community. We raise
    // max-community-size to 65 so the 60-file merged community is not
    // split by size enforcement (separate concern from hub exclusion).
    const result = runScript(root, ['--max-community-size=65', '--resolution=0.4']);
    expect(result.status).toBe(0);

    const batches = readBatches(root);
    const authBatch = batches.batches.find(b =>
      b.files.some(f => f.path === 'src/auth/auth0.ts'));
    const payBatch = batches.batches.find(b =>
      b.files.some(f => f.path === 'src/payments/pay0.ts'));
    expect(authBatch).toBeDefined();
    expect(payBatch).toBeDefined();
    // Hub connects them, so Louvain groups them in the same batch
    expect(authBatch.batchIndex).toBe(payBatch.batchIndex);
  });
});

// ── Test Group 2: --max-dirs-per-batch ────────────────────────────────────────

describe('compute-batches.mjs — --max-dirs-per-batch', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('splits mixed-dir batches exceeding the directory limit', () => {
    root = setupProject('scan-result-mixed-dirs.json');
    // The bridge utils import from both auth and payments, pulling files
    // from all 3 directories into one Louvain batch. --max-dirs-per-batch=2
    // should split any batch spanning >2 distinct second-level directories.
    const result = runScript(root, ['--max-dirs-per-batch=2']);
    expect(result.status).toBe(0);

    const batches = readBatches(root);
    for (const b of batches.batches) {
      const dirs = new Set(b.files.map(f => {
        const parts = f.path.split('/');
        return parts.length > 1 ? parts[1] : parts[0];
      }));
      expect(dirs.size).toBeLessThanOrEqual(2);
    }
  });

  it('does not split when --max-dirs-per-batch is not set', () => {
    root = setupProject('scan-result-mixed-dirs.json');
    // Without the flag, bridging edges may pull auth + payments + utils into
    // the same batch. That is the current default behavior — no directory
    // constraint applied.
    const result = runScript(root);
    expect(result.status).toBe(0);

    const batches = readBatches(root);
    // At least one batch should span 3 directories (auth, payments, utils)
    // because the bridge files connect the clusters.
    const hasMultiDirBatch = batches.batches.some(b => {
      const dirs = new Set(b.files.map(f => {
        const parts = f.path.split('/');
        return parts.length > 1 ? parts[1] : parts[0];
      }));
      return dirs.size >= 3;
    });
    expect(hasMultiDirBatch).toBe(true);
  });
});

// ── Test Group 3: per-batch intra-ratio % ────────────────────────────────────

describe('compute-batches.mjs — per-batch intra-ratio %', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('includes intra-ratio percentage in dry-run stderr output', () => {
    root = setupProject('scan-result-3-cliques.json');
    // --dry-run prints per-batch listings to stderr. After the new feature,
    // each batch listing should include an intra-ratio percentage like "85.7%".
    const result = runScript(root, ['--dry-run', '--min-batch-size=3']);
    expect(result.status).toBe(0);

    // The global diagnostic line already has intra-edge=XX.X%.
    // The per-batch listings should also carry a ratio, e.g. "intra-ratio 100.0%"
    // or similar format with a decimal percentage.
    expect(result.stderr).toMatch(/intra.ratio.*\d+\.\d+%/i);
  });
});

// ── Test Group 4: diagnostic output ──────────────────────────────────────────

describe('compute-batches.mjs — diagnostic output', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('reports hub-files count in diagnostic output', () => {
    root = setupProject('scan-result-hub.json');
    const result = runScript(root, ['--exclude-hubs=50']);
    expect(result.status).toBe(0);

    // Diagnostic line should mention the number of hub files excluded,
    // e.g. "hub-files=1" or "1 hub files excluded"
    expect(result.stderr).toMatch(/hub.files/i);
  });

  it('reports mixed-dir batch count in diagnostic output', () => {
    root = setupProject('scan-result-mixed-dirs.json');
    const result = runScript(root, ['--max-dirs-per-batch=2']);
    expect(result.status).toBe(0);

    // Diagnostic line should report how many batches were split due to
    // directory limit, e.g. "mixed-dir" or "Coherence" or "split" count
    expect(result.stderr).toMatch(/mixed.dir|Coherence|dir.split/i);
  });
});
