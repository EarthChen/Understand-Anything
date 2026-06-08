import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
