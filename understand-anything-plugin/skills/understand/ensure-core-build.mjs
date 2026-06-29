import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.json']);

function hasSourceExtension(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 && SOURCE_EXTENSIONS.has(fileName.slice(dot));
}

function latestMtimeMs(path) {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (stat.isFile()) return stat.mtimeMs;
  if (!stat.isDirectory()) return 0;

  let latest = stat.mtimeMs;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const childPath = join(path, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestMtimeMs(childPath));
    } else if (entry.isFile() && hasSourceExtension(entry.name)) {
      latest = Math.max(latest, statSync(childPath).mtimeMs);
    }
  }
  return latest;
}

export function ensureCoreBuild(pluginRoot) {
  const distEntry = join(pluginRoot, 'packages/core/dist/index.js');
  const srcDir = join(pluginRoot, 'packages/core/src');
  const packageJson = join(pluginRoot, 'packages/core/package.json');

  let reason = '';
  if (!existsSync(distEntry)) {
    reason = 'missing dist';
  } else {
    const distMtime = statSync(distEntry).mtimeMs;
    const sourceMtime = Math.max(latestMtimeMs(srcDir), latestMtimeMs(packageJson));
    if (sourceMtime > distMtime + 1) {
      reason = 'source newer than dist';
    }
  }

  if (!reason) return;

  process.stderr.write(`ensure-core-build: rebuilding @understand-anything/core (${reason})\n`);
  const result = spawnSync('pnpm', ['--filter', '@understand-anything/core', 'build'], {
    cwd: pluginRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    const detail = result.error ? `: ${result.error.message}` : '';
    throw new Error(`Failed to build @understand-anything/core${detail}`);
  }
}
