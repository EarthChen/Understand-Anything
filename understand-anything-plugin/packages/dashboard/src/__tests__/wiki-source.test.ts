import path from "path";
import { describe, expect, it } from "vitest";
import {
  MAX_WIKI_SOURCE_LINES,
  parseWikiSourceLineRange,
  resolvePathWithinProjectRoot,
  sanitizeWikiSourcePath,
  sliceSourceLines,
} from "../../wiki-source";

describe("sanitizeWikiSourcePath", () => {
  it("accepts a normal relative path", () => {
    expect(sanitizeWikiSourcePath("src/main/java/Foo.java")).toBe("src/main/java/Foo.java");
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(sanitizeWikiSourcePath("src\\main\\Foo.java")).toBe("src/main/Foo.java");
  });

  it("rejects empty paths", () => {
    expect(sanitizeWikiSourcePath("")).toBeNull();
    expect(sanitizeWikiSourcePath("   ")).toBeNull();
  });

  it("rejects absolute paths", () => {
    expect(sanitizeWikiSourcePath("/etc/passwd")).toBeNull();
    if (process.platform === "win32") {
      expect(sanitizeWikiSourcePath("C:\\Windows\\system.ini")).toBeNull();
    }
  });

  it("rejects parent-directory traversal", () => {
    expect(sanitizeWikiSourcePath("../secret.txt")).toBeNull();
    expect(sanitizeWikiSourcePath("src/../../etc/passwd")).toBeNull();
    expect(sanitizeWikiSourcePath("..")).toBeNull();
    expect(sanitizeWikiSourcePath(".")).toBeNull();
  });

  it("rejects null bytes", () => {
    expect(sanitizeWikiSourcePath("src\0/evil.java")).toBeNull();
  });

  it("rejects tilde home expansion", () => {
    expect(sanitizeWikiSourcePath("~/secret.txt")).toBeNull();
  });
});

describe("resolvePathWithinProjectRoot", () => {
  const root = path.resolve("/tmp/wiki-project");

  it("resolves safe paths inside the project root", () => {
    const resolved = resolvePathWithinProjectRoot(root, "src/App.java");
    expect(resolved).toBe(path.resolve(root, "src/App.java"));
  });

  it("rejects paths that escape the project root after resolution", () => {
    expect(resolvePathWithinProjectRoot(root, "../outside.txt")).toBeNull();
  });
});

describe("parseWikiSourceLineRange", () => {
  it("defaults to the first max-preview window when params are missing", () => {
    expect(parseWikiSourceLineRange(null, null)).toEqual({
      startLine: 1,
      endLine: MAX_WIKI_SOURCE_LINES,
    });
  });

  it("uses start as end when end is omitted", () => {
    expect(parseWikiSourceLineRange("10", null)).toEqual({ startLine: 10, endLine: 10 });
  });

  it("rejects invalid line numbers", () => {
    expect(parseWikiSourceLineRange("0", "5")).toEqual({ error: "Invalid line range" });
    expect(parseWikiSourceLineRange("foo", "5")).toEqual({ error: "Invalid line range" });
    expect(parseWikiSourceLineRange("5", "3")).toEqual({ error: "Invalid line range" });
  });

  it("rejects ranges wider than the maximum", () => {
    const wide = parseWikiSourceLineRange("1", String(MAX_WIKI_SOURCE_LINES + 1));
    expect(wide).toEqual({ error: `Line range exceeds maximum of ${MAX_WIKI_SOURCE_LINES} lines` });
  });
});

describe("sliceSourceLines", () => {
  const content = "line1\nline2\nline3\nline4\n";

  it("returns the requested inclusive slice", () => {
    expect(sliceSourceLines(content, 2, 3)).toEqual({
      content: "line2\nline3",
      startLine: 2,
      endLine: 3,
    });
  });

  it("clamps end to file length", () => {
    expect(sliceSourceLines(content, 3, 99)).toEqual({
      content: "line3\nline4",
      startLine: 3,
      endLine: 4,
    });
  });
});
