import path from "path";
import fs from "fs";

const SAFE_SLUG = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const UNSAFE_PATH_SEGMENT = /(^|\/)\.\.(\/|$)/;

/** Wiki slug / service name — no path separators. */
export function sanitizeSlug(input: string): string | null {
  const slug = input
    .replace(/^(?:wiki:)?(?:cross-domain|domain):/, "")
    .replace(/^wiki:/, "")
    .replace(/\.json$/, "");
  if (!slug || !SAFE_SLUG.test(slug)) return null;
  if (slug.includes("..") || slug.includes("/") || slug.includes("\\") || slug.includes("\0")) {
    return null;
  }
  return slug;
}

/** Relative file paths for wiki source preview — allows `/`, blocks traversal. */
export function sanitizeFilePath(filePath: string): string | null {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.includes("\0")) return null;
  if (path.isAbsolute(trimmed)) return null;
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) return null;
  if (trimmed.includes("~")) return null;
  if (UNSAFE_PATH_SEGMENT.test(trimmed.replace(/\\/g, "/"))) return null;

  const normalized = path.normalize(trimmed.replace(/\\/g, "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.isAbsolute(normalized)
  ) {
    return null;
  }

  return normalized.split("/").join("/");
}

export function resolvePathWithinRoot(root: string, relativePath: string): string | null {
  const safeRelative = sanitizeFilePath(relativePath);
  if (!safeRelative) return null;

  const absoluteFile = path.resolve(root, safeRelative);
  const relativeToRoot = path.relative(root, absoluteFile);
  if (
    !relativeToRoot ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    relativeToRoot === ".." ||
    path.isAbsolute(relativeToRoot)
  ) {
    return null;
  }

  // Symlink escape check: resolve real path and verify it stays within root
  try {
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(absoluteFile);
    const realRelative = path.relative(realRoot, realFile);
    if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      return null;
    }
  } catch (e: unknown) {
    // ENOENT is OK (file doesn't exist yet); other errors are suspicious
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code !== "ENOENT") {
      return null;
    }
  }

  return absoluteFile;
}
