/**
 * resume-utils.mjs — Shared checkpoint/resume utilities for batch-processing skills.
 *
 * Instead of a separate progress file, uses existing output files on disk as
 * the checkpoint. If an output file exists and is non-empty, that item is
 * considered complete.
 */

import { existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Filter items to only those that still need processing.
 * An item is "pending" if its outputPath does not exist or is empty.
 *
 * @param {Array<{id: string|number, outputPath: string}>} allItems
 * @returns {Array<{id: string|number, outputPath: string}>} items without existing output
 */
export function getPendingItems(allItems) {
  return allItems.filter(item => {
    try {
      const stat = statSync(item.outputPath);
      return stat.size === 0;
    } catch {
      return true;
    }
  });
}

/**
 * Return a Set of ids for items whose output files exist and are non-empty.
 *
 * @param {Array<{id: string|number, outputPath: string}>} allItems
 * @returns {Set<string|number>}
 */
export function getCompletedIds(allItems) {
  const ids = new Set();
  for (const item of allItems) {
    try {
      const stat = statSync(item.outputPath);
      if (stat.size > 0) ids.add(item.id);
    } catch {
      // file missing — not completed
    }
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
