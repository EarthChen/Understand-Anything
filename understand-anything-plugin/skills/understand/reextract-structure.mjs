#!/usr/bin/env node
/**
 * reextract-structure.mjs
 *
 * Full deterministic re-extraction pipeline: scan → imports → structure → source index.
 * Always does a fresh filesystem scan — no flags needed.
 *
 * Usage:
 *   node reextract-structure.mjs <projectRoot>
 *
 * Output:
 *   - .understand-anything/intermediate/extraction/structural-analysis.json
 *   - .understand-anything/intermediate/extraction/source-index.json
 */

import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Parse arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`用法: node reextract-structure.mjs <PROJECT_ROOT> [--pull]
示例:
  node reextract-structure.mjs /path/to/project
  node reextract-structure.mjs /path/to/project --pull`);
  process.exit(0);
}

const positional = args.filter(a => !a.startsWith('--'));
const projectRoot = resolve(positional[0]);
const doPull = args.includes('--pull');

if (!existsSync(projectRoot)) {
  console.error(`错误: 项目根目录不存在: ${projectRoot}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Setup paths
// ---------------------------------------------------------------------------
const tmpDir = join(projectRoot, '.understand-anything/tmp');
const interDir = join(projectRoot, '.understand-anything/intermediate');
const extractDir = join(interDir, 'extraction');
const scanOutputPath = join(interDir, 'scan-result.json');
const importMapInputPath = join(tmpDir, 'import-map-input.json');
const importMapOutputPath = join(tmpDir, 'import-map-output.json');
const extractInputPath = join(tmpDir, 'extract-input.json');
const extractOutputPath = join(tmpDir, 'ua-extract-results-full.json');
const structuralOutputPath = join(extractDir, 'structural-analysis.json');

console.log('=== 重新提取结构信息 ===');
console.log(`项目根目录: ${projectRoot}`);

mkdirSync(tmpDir, { recursive: true });
mkdirSync(extractDir, { recursive: true });

// ---------------------------------------------------------------------------
// Step 0: git pull (optional)
// ---------------------------------------------------------------------------
if (doPull) {
  console.log('\n步骤0: git pull 更新代码...');
  const pullResult = spawnSync('git', ['pull'], { stdio: 'inherit', cwd: projectRoot });
  if (pullResult.status !== 0) {
    console.error('错误: git pull 失败');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Step 1: scan-project.mjs — fresh filesystem scan
// ---------------------------------------------------------------------------
console.log('\n步骤1: 扫描文件列表...');

const scanResult = spawnSync('node', [
  join(__dirname, 'scan-project.mjs'),
  projectRoot,
  scanOutputPath,
], { stdio: 'inherit', cwd: __dirname });

if (scanResult.status !== 0) {
  console.error('错误: scan-project.mjs 执行失败');
  process.exit(1);
}

const scanData = JSON.parse(readFileSync(scanOutputPath, 'utf-8'));
const fileList = scanData.files || [];

if (fileList.length === 0) {
  console.error('错误: 扫描结果中没有文件列表');
  process.exit(1);
}

console.log(`  文件列表: ${fileList.length} 个文件`);

// ---------------------------------------------------------------------------
// Step 2: extract-import-map.mjs — resolve import dependencies
// ---------------------------------------------------------------------------
console.log('\n步骤2: 解析 import 依赖...');

const importMapInput = {
  projectRoot,
  files: fileList.map(f => ({ path: f.path, language: f.language, fileCategory: f.fileCategory })),
};
writeFileSync(importMapInputPath, JSON.stringify(importMapInput, null, 2));

const importMapResult = spawnSync('node', [
  join(__dirname, 'extract-import-map.mjs'),
  importMapInputPath,
  importMapOutputPath,
], { stdio: 'inherit', cwd: __dirname });

let importData = {};
if (importMapResult.status !== 0) {
  console.warn('  警告: extract-import-map.mjs 执行失败，继续不带 import 数据');
} else {
  const importMapData = JSON.parse(readFileSync(importMapOutputPath, 'utf-8'));
  importData = importMapData.importMap || {};
  const edgeCount = importMapData.stats?.totalEdges || 0;
  console.log(`  import 解析完成: ${Object.keys(importData).length} 个文件, ${edgeCount} 条边`);

  // Merge importMap into scan-result.json (follows understand pipeline convention)
  scanData.importMap = importData;
  writeFileSync(scanOutputPath, JSON.stringify(scanData, null, 2));
  console.log(`  importMap 已写入 scan-result.json`);
}

// ---------------------------------------------------------------------------
// Step 3: extract-structure.mjs — structural analysis
// ---------------------------------------------------------------------------
console.log('\n步骤3: 提取代码结构...');

const extractInput = { projectRoot, fileList, importData };
writeFileSync(extractInputPath, JSON.stringify(extractInput, null, 2));

const extractRes = spawnSync('node', [
  join(__dirname, 'extract-structure.mjs'),
  extractInputPath,
  extractOutputPath,
], { stdio: 'inherit', cwd: __dirname });

if (extractRes.status !== 0) {
  console.error('错误: extract-structure.mjs 执行失败');
  process.exit(1);
}

const extractData = JSON.parse(readFileSync(extractOutputPath, 'utf-8'));
const results = extractData.results || [];
const totalFunctions = results.reduce((s, r) => s + (r.functions?.length || 0), 0);

// Count classes by kind
const kindCounts = {};
for (const r of results) {
  for (const cls of (r.classes || [])) {
    const kind = cls.kind || 'class';
    kindCounts[kind] = (kindCounts[kind] || 0) + 1;
  }
}
const totalClasses = Object.values(kindCounts).reduce((a, b) => a + b, 0);

console.log(`  分析完成: ${results.length} 个文件`);
console.log(`  函数总数: ${totalFunctions}`);
console.log(`  类总数: ${totalClasses}`);
for (const [kind, count] of Object.entries(kindCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${kind}: ${count}`);
}

// ---------------------------------------------------------------------------
// Step 4: Convert to file-path-indexed format
// ---------------------------------------------------------------------------
console.log('\n步骤4: 生成 structural-analysis.json...');

const merged = {};
for (const r of results) {
  if (r.path) {
    const { path: _, ...rest } = r;
    merged[r.path] = rest;
  }
}

writeFileSync(structuralOutputPath, JSON.stringify(merged, null, 2));
console.log(`  写入: ${structuralOutputPath} (${Object.keys(merged).length} 个文件)`);

// ---------------------------------------------------------------------------
// Step 5: build-source-index.mjs — source search index
// ---------------------------------------------------------------------------
console.log('\n步骤5: 构建源码索引...');

const sourceIndexRes = spawnSync('node', [
  join(__dirname, 'build-source-index.mjs'),
  projectRoot,
], { stdio: 'inherit', cwd: __dirname });

if (sourceIndexRes.status !== 0) {
  console.warn('  警告: build-source-index.mjs 执行失败');
} else {
  const sourceIndexPath = join(extractDir, 'source-index.json');
  if (existsSync(sourceIndexPath)) {
    const sizeMB = (Buffer.byteLength(readFileSync(sourceIndexPath)) / 1024 / 1024).toFixed(2);
    console.log(`  源码索引: ${sourceIndexPath} (${sizeMB} MB)`);
  }
}

// ---------------------------------------------------------------------------
// Step 6: Summary
// ---------------------------------------------------------------------------
console.log('\n步骤6: 结构索引统计...');

const summaryKinds = {};
let summaryFunctions = 0;
let summaryExports = 0;
let summaryEndpoints = 0;
for (const fd of Object.values(merged)) {
  for (const cls of (fd.classes || [])) {
    const kind = cls.kind || 'class';
    summaryKinds[kind] = (summaryKinds[kind] || 0) + 1;
  }
  summaryFunctions += (fd.functions || []).length;
  summaryExports += (fd.exports || []).length;
  summaryEndpoints += (fd.endpoints || []).length;
}

console.log(`  类: ${Object.entries(summaryKinds).map(([k, v]) => `${k}=${v}`).join('  ')}`);
console.log(`  函数: ${summaryFunctions}  |  导出: ${summaryExports}  |  端点: ${summaryEndpoints}`);

// ---------------------------------------------------------------------------
// Step 7: Cleanup
// ---------------------------------------------------------------------------
console.log('\n步骤7: 清理临时文件...');
rmSync(tmpDir, { recursive: true, force: true });

console.log('\n=== 完成 ===');
console.log(`  structural-analysis.json → ${structuralOutputPath}`);
console.log(`  source-index.json        → ${join(extractDir, 'source-index.json')}`);
