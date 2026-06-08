#!/usr/bin/env node
/**
 * validate-wiki-schema.mjs
 *
 * Validates wiki JSON files in an intermediate directory against
 * @understand-anything/core schemas. Auto-fixes recoverable issues.
 *
 * Usage:
 *   node validate-wiki-schema.mjs <intermediate_wiki_dir> [--parent] [--service-root=<path>] [--verify-only]
 *
 * Output: <parent_of_wiki_dir>/wiki-validation-report.json
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "../..");
const coreDist = join(pluginRoot, "packages/core/dist/index.js");

if (!existsSync(coreDist)) {
  console.error(
    `[validate-wiki-schema] Core package not built. Run: cd ${pluginRoot} && pnpm --filter @understand-anything/core build`,
  );
  process.exit(1);
}

const core = await import(pathToFileURL(coreDist).href);

const args = process.argv.slice(2);
const isParent = args.includes("--parent");
const verifyOnly = args.includes("--verify-only");
const serviceRootArg = args.find((a) => a.startsWith("--service-root="));
const serviceRoot = serviceRootArg ? serviceRootArg.slice("--service-root=".length) : null;
const wikiDirArg = args.find((a) => !a.startsWith("--"));

if (!wikiDirArg) {
  console.error(
    "Usage: node validate-wiki-schema.mjs <intermediate_wiki_dir> [--parent] [--service-root=<path>]",
  );
  process.exit(1);
}

const wikiDir = resolve(wikiDirArg);

function loadJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function writeJSON(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

const report = {
  passed: true,
  autoFixed: 0,
  errors: [],
  warnings: [],
  filesProcessed: 0,
  filesSkipped: 0,
};

function addIssue(severity, msg) {
  if (severity === "error") {
    report.errors.push(msg);
    report.passed = false;
  } else {
    report.warnings.push(msg);
  }
}

function applyValidationIssues(issues) {
  for (const i of issues) {
    addIssue(i.severity, `${i.file}: ${i.message}`);
  }
}

function checkSourceRefs(pageData, domainFile) {
  if (!serviceRoot || !pageData?.flows) return;
  for (const flow of pageData.flows) {
    if (!Array.isArray(flow.steps)) continue;
    for (const step of flow.steps) {
      if (step.sourceRef?.file) {
        const refPath = join(serviceRoot, step.sourceRef.file);
        if (!existsSync(refPath)) {
          addIssue(
            "warning",
            `domains/${domainFile}: sourceRef '${step.sourceRef.file}' does not exist on disk`,
          );
        }
      }
    }
  }
}

if (!existsSync(wikiDir)) {
  addIssue("error", `Wiki directory not found: ${wikiDir}`);
} else if (isParent) {
  for (const [file, validator] of [
    ["overview.json", core.validateParentWikiOverview],
    ["architecture.json", core.validateParentWikiArchitecture],
  ]) {
    const path = join(wikiDir, file);
    if (!existsSync(path)) {
      addIssue("warning", `${file}: not found`);
      report.filesSkipped++;
      continue;
    }
    const data = loadJSON(path);
    if (!data) {
      addIssue("error", `${file}: invalid JSON`);
      report.filesSkipped++;
      continue;
    }
    applyValidationIssues(validator(data, file));
    report.filesProcessed++;
  }

  const domainDir = join(wikiDir, "domains");
  if (existsSync(domainDir)) {
    for (const f of readdirSync(domainDir).filter((name) => name.endsWith(".json"))) {
      const data = loadJSON(join(domainDir, f));
      if (!data) {
        addIssue("error", `domains/${f}: invalid JSON`);
        report.filesSkipped++;
        continue;
      }
      applyValidationIssues(core.validateParentWikiCrossDomain(data, `domains/${f}`));
      report.filesProcessed++;
    }
  } else {
    addIssue("warning", "domains/: directory not found");
  }
} else {
  const servicePath = join(wikiDir, "service.json");
  if (existsSync(servicePath)) {
    const data = loadJSON(servicePath);
    if (!data) {
      addIssue("error", "service.json: invalid JSON");
      report.filesSkipped++;
    } else {
      applyValidationIssues(core.validateWikiServiceOverview(data, "service.json"));
      report.filesProcessed++;
    }
  } else {
    addIssue("error", "service.json: not found");
    report.filesSkipped++;
  }

  const domainDir = join(wikiDir, "domains");
  if (existsSync(domainDir)) {
    for (const f of readdirSync(domainDir).filter((name) => name.endsWith(".json"))) {
      const filePath = join(domainDir, f);
      const relPath = `domains/${f}`;
      let data = loadJSON(filePath);
      if (!data) {
        addIssue("error", `${relPath}: invalid JSON`);
        report.filesSkipped++;
        continue;
      }

      if (typeof core.autoFixDomainPage === "function") {
        const { data: fixed, fixes } = core.autoFixDomainPage(data, relPath);
        if (fixes.length > 0) {
          if (verifyOnly) {
            for (const fix of fixes) addIssue("error", `${relPath}: unfixed issue (verify-only): ${fix}`);
          } else {
            writeJSON(filePath, fixed);
            report.autoFixed += fixes.length;
            for (const fix of fixes) report.warnings.push(fix);
          }
        }
        data = fixed;
      }

      const expectedId = `domain:${f.replace(/\.json$/, "")}`;
      if (data.id !== expectedId) {
        if (verifyOnly) {
          addIssue("error", `${relPath}: id mismatch: '${data.id ?? "(missing)"}' should be '${expectedId}'`);
        } else {
          const previousId = data.id ?? "(missing)";
          data.id = expectedId;
          writeJSON(filePath, data);
          report.autoFixed++;
          report.warnings.push(
            `${relPath}: id corrected from '${previousId}' to '${expectedId}'`,
          );
        }
      }

      applyValidationIssues(core.validateWikiDomainPage(data, relPath));
      checkSourceRefs(data, f);
      report.filesProcessed++;
    }
  } else {
    addIssue("error", "domains/: directory not found");
  }
}

// --- Quality gate rules ---

// Rule 1: Check knowledge-graph.json layer ID integrity
const kgPath = serviceRoot
  ? join(serviceRoot, ".understand-anything", "knowledge-graph.json")
  : null;
if (kgPath && existsSync(kgPath)) {
  const kg = loadJSON(kgPath);
  if (kg && Array.isArray(kg.layers)) {
    const seenIds = new Set();
    for (const layer of kg.layers) {
      const id = layer.id;
      if (!id || id === "layer:") {
        addIssue("warning", `Layer has empty or bare 'layer:' id: ${JSON.stringify(layer)}`);
      }
      if (id && seenIds.has(id)) {
        addIssue("warning", `Duplicate layer id: ${id}`);
      }
      if (id) seenIds.add(id);
    }
  }
}

// Rule 2: Service wiki has entryPoints but no endpoint data
if (!isParent && existsSync(wikiDir)) {
  const servicePath = join(wikiDir, "service.json");
  if (existsSync(servicePath)) {
    const svcData = loadJSON(servicePath);
    if (svcData && Array.isArray(svcData.entryPoints) && svcData.entryPoints.length > 0) {
      const endpointsDir = join(wikiDir, "endpoints");
      const svcName = svcData.name || "";
      const endpointFile = join(endpointsDir, `${svcName}.json`);
      if (!existsSync(endpointFile)) {
        addIssue(
          "warning",
          `service.json has ${svcData.entryPoints.length} entryPoints but no endpoints/${svcName}.json found`,
        );
      }
    }
  }
}

// Rule 3: Provider has sourceRef but empty methods
if (!isParent && existsSync(wikiDir)) {
  const endpointsDir = join(wikiDir, "endpoints");
  if (existsSync(endpointsDir)) {
    for (const f of readdirSync(endpointsDir).filter((n) => n.endsWith(".json") && n !== "index.json")) {
      const data = loadJSON(join(endpointsDir, f));
      if (!data || !Array.isArray(data.providers)) continue;
      for (const p of data.providers) {
        if (p.sourceRef && (!Array.isArray(p.methods) || p.methods.length === 0)) {
          addIssue(
            "warning",
            `endpoints/${f}: provider '${p.identifier}' has sourceRef but empty methods`,
          );
        }
      }
    }
  }
}

// Rule 4: Parent wiki has 2+ services but no endpoints/index.json
if (isParent && existsSync(wikiDir)) {
  const overviewPath = join(wikiDir, "overview.json");
  if (existsSync(overviewPath)) {
    const overview = loadJSON(overviewPath);
    if (overview && Array.isArray(overview.services) && overview.services.length >= 2) {
      const indexFile = join(wikiDir, "endpoints", "index.json");
      if (!existsSync(indexFile)) {
        addIssue(
          "warning",
          `Parent wiki has ${overview.services.length} services but no endpoints/index.json`,
        );
      }
    }
  }
}

const reportPath = join(dirname(wikiDir), "wiki-validation-report.json");
writeJSON(reportPath, report);

if (report.passed) {
  console.log(
    `[validate-wiki-schema] PASSED — ${report.filesProcessed} files, ${report.autoFixed} auto-fixes, ${report.warnings.length} warnings`,
  );
} else {
  console.error(
    `[validate-wiki-schema] FAILED — ${report.errors.length} errors, ${report.filesProcessed} files, ${report.autoFixed} auto-fixes`,
  );
  for (const e of report.errors) console.error(`  ERROR: ${e}`);
}
for (const w of report.warnings) console.log(`  WARN: ${w}`);

process.exit(report.passed ? 0 : 1);
