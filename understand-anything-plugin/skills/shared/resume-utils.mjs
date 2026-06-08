/**
 * resume-utils.mjs — Shared checkpoint/resume utilities for batch-processing skills.
 *
 * Uses output files on disk as checkpoints with a three-state model:
 * - complete: valid output, skip on resume
 * - degraded: partial output, reprocess on next run
 * - failed: error output, retry on next run
 * Legacy files without _checkpoint metadata are treated as complete (backward compat).
 */

import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Filter items to only those that still need processing.
 * An item is "pending" if its checkpoint is not valid (missing, empty, corrupted,
 * degraded, or failed).
 *
 * @param {Array<{id: string|number, outputPath: string}>} allItems
 * @returns {Array<{id: string|number, outputPath: string}>} items needing reprocessing
 */
export function getPendingItems(allItems) {
  return allItems.filter(item => {
    const result = isValidCheckpoint(item.outputPath);
    return !result.valid;
  });
}

/**
 * Return a Set of ids for items with a valid checkpoint (complete status or legacy
 * file without `_checkpoint` metadata).
 *
 * @param {Array<{id: string|number, outputPath: string}>} allItems
 * @returns {Set<string|number>}
 */
export function getCompletedIds(allItems) {
  const ids = new Set();
  for (const item of allItems) {
    const result = isValidCheckpoint(item.outputPath);
    if (result.valid) ids.add(item.id);
  }
  return ids;
}

/**
 * Check whether a batch has existing output in an intermediate directory.
 * Handles both single-file mode (batch-<i>.json) and split-file mode
 * (batch-<i>-part-<k>.json).
 *
 * @param {string} projectRoot
 * @param {string} intermediateRel - relative path from projectRoot (e.g. ".understand-anything/intermediate")
 * @param {number} batchIndex
 * @returns {boolean}
 */
export function hasBatchOutput(projectRoot, intermediateRel, batchIndex) {
  const dir = join(projectRoot, intermediateRel);
  const prefix = `batch-${batchIndex}`;

  // Single-file mode
  const singlePath = join(dir, `${prefix}.json`);
  if (existsSync(singlePath)) {
    try {
      if (statSync(singlePath).size > 0) return true;
    } catch {
      // fall through
    }
  }

  // Split-file mode: batch-<i>-part-<k>.json
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  const partPattern = new RegExp(`^${prefix}-part-\\d+\\.json$`);
  for (const entry of entries) {
    if (!partPattern.test(entry)) continue;
    try {
      if (statSync(join(dir, entry)).size > 0) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Generate a human-readable progress report string.
 *
 * @param {Array<{id: string|number, outputPath: string}>} allItems
 * @returns {string} e.g. "Resuming: 3/10 batches already complete. Dispatching remaining 7..."
 */
export function reportProgress(allItems) {
  const total = allItems.length;
  if (total === 0) return 'No items to process.';
  const completed = total - getPendingItems(allItems).length;
  const remaining = total - completed;
  if (completed === 0) {
    return `Starting fresh: 0/${total} complete. Dispatching all ${total}...`;
  }
  if (remaining === 0) {
    return `All ${total}/${total} items already complete.`;
  }
  return `Resuming: ${completed}/${total} batches already complete. Dispatching remaining ${remaining}...`;
}

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
    // _checkpoint exists but status is unrecognized — not a legacy file
    if (checkpoint && typeof checkpoint.status === 'string') {
      console.warn(`[resume-utils] Unrecognized checkpoint status: "${checkpoint.status}" in ${filePath}`);
      return { valid: false, status: 'unknown' };
    }
    // Legacy file without _checkpoint metadata — backward compat
    return { valid: true, status: 'complete' };
  } catch {
    return { valid: false, status: 'corrupted' };
  }
}
