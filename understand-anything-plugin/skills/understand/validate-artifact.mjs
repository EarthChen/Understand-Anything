/**
 * validate-artifact.mjs
 *
 * Unified artifact validator for the Understand Anything pipeline.
 * Checks artifact existence, JSON validity, provenance completeness, and staleness.
 *
 * Usage:
 *   node validate-artifact.mjs <artifact-path> <contract>
 *
 * Contracts:
 *   knowledge-graph:complete — requires provenance with all stages
 *   domain-graph:complete   — requires provenance with all stages
 *   wiki:complete           — requires provenance with all stages
 *
 * Exit codes:
 *   0 = valid (complete)
 *   1 = invalid (missing/degraded/stale)
 */

import { readFileSync, realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Contract definitions: required stages per artifact type
// ---------------------------------------------------------------------------
const CONTRACT_STAGES = {
  "knowledge-graph:complete": ["scan", "batch", "extract", "analyze", "merge", "validate"],
  "domain-graph:complete": ["derive"],
  "wiki:complete": ["generate"],
};

// ---------------------------------------------------------------------------
// Core validation function
// Exported for unit tests; pure function when deps are injected.
// ---------------------------------------------------------------------------
export function validateArtifact({ artifactPath, contract, readFile, getGitCommitHash, semanticCheck }) {
  const requiredStages = CONTRACT_STAGES[contract];
  if (!requiredStages) {
    return { valid: false, status: "error", reason: `unknown contract: ${contract}` };
  }

  // 1. Check file existence
  let content;
  try {
    content = readFile(artifactPath);
  } catch {
    return { valid: false, status: "missing", reason: `file not found: ${artifactPath}` };
  }

  // 2. Check JSON validity
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    return { valid: false, status: "degraded", reason: "invalid JSON" };
  }

  // 3. Check provenance exists
  const provenance = data?.project?.provenance;
  if (!provenance) {
    return { valid: false, status: "degraded", reason: "no provenance — rebuild required" };
  }

  // 4. Check degraded flag
  if (provenance.degraded === true) {
    return { valid: false, status: "degraded", reason: "provenance.degraded is true" };
  }

  // 5. Check completed stages
  const completed = new Set(provenance.completedStages || []);
  const missing = requiredStages.filter(s => !completed.has(s));
  if (missing.length > 0) {
    return { valid: false, status: "degraded", reason: `missing stages: ${missing.join(", ")}` };
  }

  // 6. Check staleness (git commit hash)
  const currentHash = getGitCommitHash();
  if (currentHash && provenance.gitCommitHash && provenance.gitCommitHash !== currentHash) {
    return { valid: false, status: "stale", reason: `commit mismatch: artifact=${provenance.gitCommitHash} current=${currentHash}` };
  }

  // 7. Semantic check (optional)
  if (semanticCheck?.sourceFiles) {
    const semanticResult = checkSemanticCompleteness(data, semanticCheck.sourceFiles);
    if (!semanticResult.valid) {
      return { valid: false, status: "degraded", reason: semanticResult.reason };
    }
  }

  return { valid: true, status: "complete", reason: null };
}

// ---------------------------------------------------------------------------
// Semantic completeness check
// ---------------------------------------------------------------------------
const RPC_ANNOTATIONS = {
  "@MoaProvider": "provides_rpc",
  "@DubboService": "provides_rpc",
  "@GrpcService": "provides_rpc",
  "@MoaConsumer": "consumes_rpc",
  "@DubboReference": "consumes_rpc",
  "@GrpcClient": "consumes_rpc",
  "@FeignClient": "consumes_rpc",
};

function checkSemanticCompleteness(graph, sourceFiles) {
  const edgeTypes = new Set((graph.edges || []).map(e => e.type));
  const annotations = [];

  for (const file of sourceFiles) {
    for (const [annotation, requiredEdge] of Object.entries(RPC_ANNOTATIONS)) {
      if (file.content.includes(annotation)) {
        annotations.push({ annotation, requiredEdge, file: file.path });
      }
    }
  }

  const missing = annotations.filter(a => !edgeTypes.has(a.requiredEdge));
  if (missing.length > 0) {
    const details = missing.map(m => `${m.annotation} in ${m.file} requires ${m.requiredEdge} edge`).join("; ");
    return { valid: false, reason: `semantic completeness: ${details}` };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
// Symlink-safe CLI detection — resolves both paths before comparing.
// Mirrors the pattern in extract-structure.mjs (issue #162).
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    const argvPath = realpathSync(process.argv[1]);
    return modulePath === argvPath;
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  const [,, artifactPath, contract] = process.argv;
  if (!artifactPath || !contract) {
    process.stderr.write('Usage: node validate-artifact.mjs <artifact-path> <contract>\n');
    process.exit(1);
  }

  let currentHash;
  try {
    currentHash = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    currentHash = null;
  }

  const result = validateArtifact({
    artifactPath,
    contract,
    readFile: (p) => readFileSync(p, 'utf-8'),
    getGitCommitHash: () => currentHash,
  });

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.valid ? 0 : 1);
}
