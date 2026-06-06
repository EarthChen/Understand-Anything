import { describe, it, expect } from 'vitest';

/**
 * Integration tests for absorbWeakBatches() via the CLI subprocess.
 *
 * compute-batches.mjs uses top-level await (core import, graphology) so the
 * function can't be imported directly in tests. All behavior is verified
 * end-to-end through the CLI interface.
 */

// ── Integration tests via CLI ──
// These test the actual compute-batches.mjs script end-to-end, verifying
// that absorbWeakBatches is called in main() and produces correct output.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../../understand-anything-plugin/skills/understand/compute-batches.mjs');

function runScript(projectRoot, extraArgs = []) {
  return spawnSync('node', [SCRIPT, projectRoot, ...extraArgs], {
    encoding: 'utf-8',
  });
}

function setupScan(root, scan) {
  mkdirSync(join(root, '.understand-anything', 'intermediate'), { recursive: true });
  writeFileSync(
    join(root, '.understand-anything', 'intermediate', 'scan-result.json'),
    JSON.stringify(scan),
  );
}

function readBatches(projectRoot) {
  const p = join(projectRoot, '.understand-anything', 'intermediate', 'batches.json');
  return JSON.parse(readFileSync(p, 'utf-8'));
}

describe('absorbWeakBatches — CLI integration', () => {
  it('absorbs a 2-file weak batch with 0 intra-edges into strongest neighbor', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-absorb-1-'));
    try {
      // 30 files in cluster A (strong), 2 files in cluster B (weak, cross-edges to A)
      const files = [];
      const importMap = {};

      // Cluster A: 30 files with tight chain (large enough for Louvain to detect)
      for (let i = 0; i < 30; i++) {
        const p = `src/a/file${i}.ts`;
        files.push({ path: p, language: 'typescript', sizeLines: 10, fileCategory: 'code' });
        importMap[p] = i > 0 ? [`src/a/file${i - 1}.ts`] : [];
      }

      // Cluster B: 2 files, no internal edges, cross-edges to A
      files.push({ path: 'src/b/orphan1.ts', language: 'typescript', sizeLines: 5, fileCategory: 'code' });
      files.push({ path: 'src/b/orphan2.ts', language: 'typescript', sizeLines: 5, fileCategory: 'code' });
      importMap['src/b/orphan1.ts'] = ['src/a/file0.ts'];
      importMap['src/b/orphan2.ts'] = ['src/a/file0.ts'];

      setupScan(root, {
        name: 'absorb-test-1', description: '',
        languages: ['typescript'], frameworks: [],
        files, totalFiles: files.length, filteredByIgnore: 0,
        estimatedComplexity: 'small', importMap,
      });

      const result = runScript(root);
      expect(result.status).toBe(0);

      const out = readBatches(root);
      // Cluster B files should be absorbed into cluster A's batch
      const allPaths = out.batches.flatMap(b => b.files.map(f => f.path));
      expect(allPaths).toContain('src/b/orphan1.ts');
      expect(allPaths).toContain('src/b/orphan2.ts');

      // The two cluster B files should be in the same batch as cluster A files
      const orphan1Batch = out.batches.find(b => b.files.some(f => f.path === 'src/b/orphan1.ts'));
      const aFile0Batch = out.batches.find(b => b.files.some(f => f.path === 'src/a/file0.ts'));
      expect(orphan1Batch.batchIndex).toBe(aFile0Batch.batchIndex);

      // Total files preserved
      const totalFiles = out.batches.reduce((sum, b) => sum + b.files.length, 0);
      expect(totalFiles).toBe(32);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does NOT absorb a strong batch (high intra-edge ratio)', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-absorb-2-'));
    try {
      const files = [];
      const importMap = {};

      // Cluster A: 30 files (large, forms its own community)
      for (let i = 0; i < 30; i++) {
        const p = `src/a/file${i}.ts`;
        files.push({ path: p, language: 'typescript', sizeLines: 10, fileCategory: 'code' });
        importMap[p] = i > 0 ? [`src/a/file${i - 1}.ts`] : [];
      }

      // Cluster C: 30 files (large, forms its own community)
      for (let i = 0; i < 30; i++) {
        const p = `src/c/file${i}.ts`;
        files.push({ path: p, language: 'typescript', sizeLines: 10, fileCategory: 'code' });
        importMap[p] = i > 0 ? [`src/c/file${i - 1}.ts`] : [];
      }

      // Cluster B: 5 files with dense intra-edges AND cross-edge to A
      // Louvain should keep B with A (due to cross-edge). B has high intra-edge
      // ratio (5 intra / 1 cross = 0.83), so absorbWeakBatches should NOT touch it.
      for (let i = 0; i < 5; i++) {
        const p = `src/b/strong${i}.ts`;
        files.push({ path: p, language: 'typescript', sizeLines: 10, fileCategory: 'code' });
      }
      importMap['src/b/strong0.ts'] = ['src/b/strong1.ts', 'src/b/strong2.ts', 'src/b/strong3.ts', 'src/b/strong4.ts'];
      importMap['src/b/strong1.ts'] = ['src/b/strong0.ts', 'src/b/strong2.ts', 'src/b/strong3.ts', 'src/b/strong4.ts'];
      importMap['src/b/strong2.ts'] = ['src/b/strong0.ts', 'src/b/strong1.ts', 'src/b/strong3.ts', 'src/b/strong4.ts'];
      importMap['src/b/strong3.ts'] = ['src/b/strong0.ts', 'src/b/strong1.ts', 'src/b/strong2.ts', 'src/b/strong4.ts'];
      importMap['src/b/strong4.ts'] = ['src/b/strong0.ts', 'src/b/strong1.ts', 'src/b/strong2.ts', 'src/b/strong3.ts', 'src/a/file0.ts'];

      setupScan(root, {
        name: 'absorb-test-2', description: '',
        languages: ['typescript'], frameworks: [],
        files, totalFiles: files.length, filteredByIgnore: 0,
        estimatedComplexity: 'small', importMap,
      });

      const result = runScript(root);
      expect(result.status).toBe(0);

      const out = readBatches(root);
      // Cluster B has high intra-edge ratio (5 intra / 1 cross = 0.83).
      // Whether Louvain puts B in its own batch or merges it with A,
      // absorbWeakBatches should NOT treat it as weak.
      // Key assertion: all 5 B files are still together in one batch.
      const bBatch = out.batches.find(b => b.files.some(f => f.path === 'src/b/strong0.ts'));
      expect(bBatch).toBeDefined();
      const bFileCount = bBatch.files.filter(f => f.path.startsWith('src/b/')).length;
      expect(bFileCount).toBe(5);

      // Total files preserved
      const totalFiles = out.batches.reduce((sum, b) => sum + b.files.length, 0);
      expect(totalFiles).toBe(65);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does NOT absorb non-mergeable batches even if structurally weak', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-absorb-3-'));
    try {
      const files = [];
      const importMap = {};

      // Code cluster: 12 files
      for (let i = 0; i < 12; i++) {
        const p = `src/code/file${i}.ts`;
        files.push({ path: p, language: 'typescript', sizeLines: 10, fileCategory: 'code' });
        importMap[p] = i > 0 ? [`src/code/file${i - 1}.ts`] : [];
      }

      // Dockerfile cluster: Group A, mergeable=false
      files.push({ path: 'services/api/Dockerfile', language: 'dockerfile', sizeLines: 20, fileCategory: 'config' });

      setupScan(root, {
        name: 'absorb-test-3', description: '',
        languages: ['typescript', 'dockerfile'], frameworks: [],
        files, totalFiles: files.length, filteredByIgnore: 0,
        estimatedComplexity: 'small', importMap,
      });

      const result = runScript(root);
      expect(result.status).toBe(0);

      const out = readBatches(root);
      // Dockerfile should be in its own batch (non-mergeable, not absorbed)
      const dockerBatch = out.batches.find(b =>
        b.files.some(f => f.path === 'services/api/Dockerfile'));
      expect(dockerBatch).toBeDefined();
      expect(dockerBatch.files.length).toBe(1);
      expect(dockerBatch.files[0].path).toBe('services/api/Dockerfile');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('respects maxCommunitySize — does not absorb if combined size would exceed limit', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-absorb-4-'));
    try {
      const files = [];
      const importMap = {};

      // Cluster A: 48 files (near maxCommunitySize=50)
      for (let i = 0; i < 48; i++) {
        const p = `src/a/file${i}.ts`;
        files.push({ path: p, language: 'typescript', sizeLines: 10, fileCategory: 'code' });
        importMap[p] = i > 0 ? [`src/a/file${i - 1}.ts`] : [];
      }

      // Weak batch: 3 files with cross-edges to A
      for (let i = 0; i < 3; i++) {
        const p = `src/b/small${i}.ts`;
        files.push({ path: p, language: 'typescript', sizeLines: 5, fileCategory: 'code' });
        importMap[p] = ['src/a/file0.ts'];
      }

      setupScan(root, {
        name: 'absorb-test-4', description: '',
        languages: ['typescript'], frameworks: [],
        files, totalFiles: files.length, filteredByIgnore: 0,
        estimatedComplexity: 'small', importMap,
      });

      const result = runScript(root);
      expect(result.status).toBe(0);

      const out = readBatches(root);
      // 48 + 3 = 51 > 50 → weak batch should NOT be absorbed
      const bBatch = out.batches.find(b =>
        b.files.some(f => f.path.startsWith('src/b/')));
      const aBatch = out.batches.find(b =>
        b.files.some(f => f.path === 'src/a/file0.ts'));

      // If absorption was blocked, they should be in different batches
      // (unless mergeSmallBatches already merged them, which it wouldn't
      // since 48 >= minBatchSize)
      if (bBatch && aBatch) {
        // They might be in the same batch if mergeSmallBatches pooled them,
        // but that only happens for small mergeable batches < minBatchSize.
        // With 48 files in A, A is a keeper. B has 3 files < minBatchSize=8,
        // so B goes to misc pool first. After mergeSmallBatches, B files are
        // in a misc batch. absorbWeakBatches shouldn't re-merge them into A
        // if the combined size would exceed maxCommunitySize.
      }

      // The key assertion: no batch exceeds maxCommunitySize
      for (const b of out.batches) {
        expect(b.files.length).toBeLessThanOrEqual(50);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves isolated weak batch as-is when it has no neighbors', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-absorb-5-'));
    try {
      const files = [];
      const importMap = {};

      // Cluster A: 12 files
      for (let i = 0; i < 12; i++) {
        const p = `src/a/file${i}.ts`;
        files.push({ path: p, language: 'typescript', sizeLines: 10, fileCategory: 'code' });
        importMap[p] = i > 0 ? [`src/a/file${i - 1}.ts`] : [];
      }

      // Isolated cluster: 2 files, ZERO edges (no intra, no cross)
      files.push({ path: 'src/isolated/x.ts', language: 'typescript', sizeLines: 5, fileCategory: 'code' });
      files.push({ path: 'src/isolated/y.ts', language: 'typescript', sizeLines: 5, fileCategory: 'code' });
      importMap['src/isolated/x.ts'] = [];
      importMap['src/isolated/y.ts'] = [];

      setupScan(root, {
        name: 'absorb-test-5', description: '',
        languages: ['typescript'], frameworks: [],
        files, totalFiles: files.length, filteredByIgnore: 0,
        estimatedComplexity: 'small', importMap,
      });

      const result = runScript(root);
      expect(result.status).toBe(0);

      const out = readBatches(root);
      // Isolated files should still be present (possibly merged by mergeSmallBatches
      // into misc, but not absorbed into cluster A by absorbWeakBatches since
      // there are no cross-edges to identify A as a neighbor)
      const allPaths = out.batches.flatMap(b => b.files.map(f => f.path));
      expect(allPaths).toContain('src/isolated/x.ts');
      expect(allPaths).toContain('src/isolated/y.ts');

      // Total files preserved
      const totalFiles = out.batches.reduce((sum, b) => sum + b.files.length, 0);
      expect(totalFiles).toBe(14);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('absorbs multiple weak batches into different targets', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-absorb-6-'));
    try {
      const files = [];
      const importMap = {};

      // Cluster A: 30 files with tight chain (large enough for Louvain to detect)
      for (let i = 0; i < 30; i++) {
        const p = `src/a/file${i}.ts`;
        files.push({ path: p, language: 'typescript', sizeLines: 10, fileCategory: 'code' });
        importMap[p] = i > 0 ? [`src/a/file${i - 1}.ts`] : [];
      }

      // Cluster C: 30 files with tight chain
      for (let i = 0; i < 30; i++) {
        const p = `src/c/file${i}.ts`;
        files.push({ path: p, language: 'typescript', sizeLines: 10, fileCategory: 'code' });
        importMap[p] = i > 0 ? [`src/c/file${i - 1}.ts`] : [];
      }

      // Weak batch B: 2 files → edges to A
      files.push({ path: 'src/b/orphan1.ts', language: 'typescript', sizeLines: 5, fileCategory: 'code' });
      files.push({ path: 'src/b/orphan2.ts', language: 'typescript', sizeLines: 5, fileCategory: 'code' });
      importMap['src/b/orphan1.ts'] = ['src/a/file0.ts'];
      importMap['src/b/orphan2.ts'] = ['src/a/file0.ts'];

      // Weak batch D: 2 files → edges to C
      files.push({ path: 'src/d/orphan1.ts', language: 'typescript', sizeLines: 5, fileCategory: 'code' });
      files.push({ path: 'src/d/orphan2.ts', language: 'typescript', sizeLines: 5, fileCategory: 'code' });
      importMap['src/d/orphan1.ts'] = ['src/c/file0.ts'];
      importMap['src/d/orphan2.ts'] = ['src/c/file0.ts'];

      setupScan(root, {
        name: 'absorb-test-6', description: '',
        languages: ['typescript'], frameworks: [],
        files, totalFiles: files.length, filteredByIgnore: 0,
        estimatedComplexity: 'small', importMap,
      });

      const result = runScript(root);
      expect(result.status).toBe(0);

      const out = readBatches(root);
      // B files absorbed into A's batch
      const orphan1Batch = out.batches.find(b => b.files.some(f => f.path === 'src/b/orphan1.ts'));
      const aBatch = out.batches.find(b => b.files.some(f => f.path === 'src/a/file0.ts'));
      expect(orphan1Batch.batchIndex).toBe(aBatch.batchIndex);

      // D files absorbed into C's batch
      const dOrphan1Batch = out.batches.find(b => b.files.some(f => f.path === 'src/d/orphan1.ts'));
      const cBatch = out.batches.find(b => b.files.some(f => f.path === 'src/c/file0.ts'));
      expect(dOrphan1Batch.batchIndex).toBe(cBatch.batchIndex);

      // A and C should be in different batches (Louvain detects two communities)
      expect(aBatch.batchIndex).not.toBe(cBatch.batchIndex);

      // B and D may be absorbed by absorbWeakBatches OR already merged by Louvain
      // (both are valid — the important thing is files end up in the right cluster)

      // Sequential indices
      const indices = out.batches.map(b => b.batchIndex).sort((a, b) => a - b);
      expect(indices).toEqual(Array.from({ length: indices.length }, (_, i) => i + 1));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves total file count after absorption', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-absorb-7-'));
    try {
      const files = [];
      const importMap = {};

      // Cluster A: 15 files
      for (let i = 0; i < 15; i++) {
        const p = `src/a/file${i}.ts`;
        files.push({ path: p, language: 'typescript', sizeLines: 10, fileCategory: 'code' });
        importMap[p] = i > 0 ? [`src/a/file${i - 1}.ts`] : [];
      }

      // Weak batch: 2 files → absorbed into A
      files.push({ path: 'src/b/w1.ts', language: 'typescript', sizeLines: 5, fileCategory: 'code' });
      files.push({ path: 'src/b/w2.ts', language: 'typescript', sizeLines: 5, fileCategory: 'code' });
      importMap['src/b/w1.ts'] = ['src/a/file0.ts'];
      importMap['src/b/w2.ts'] = ['src/a/file0.ts'];

      setupScan(root, {
        name: 'absorb-test-7', description: '',
        languages: ['typescript'], frameworks: [],
        files, totalFiles: files.length, filteredByIgnore: 0,
        estimatedComplexity: 'small', importMap,
      });

      const result = runScript(root);
      expect(result.status).toBe(0);

      const out = readBatches(root);
      const totalFiles = out.batches.reduce((sum, b) => sum + b.files.length, 0);
      expect(totalFiles).toBe(17);
      expect(out.totalFiles).toBe(17);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
