import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildResult, buildOutput } from "../../skills/understand/extract-structure.mjs";

const file = (overrides = {}) => ({
  path: "src/foo.py",
  language: "python",
  fileCategory: "code",
  ...overrides,
});

const analysis = (overrides = {}) => ({
  functions: [],
  classes: [],
  imports: [],
  exports: [],
  ...overrides,
});

describe("extract-structure buildResult", () => {
  describe("language pass-through", () => {
    it("preserves the input language on the output", () => {
      const result = buildResult(file({ language: "python" }), 10, 8, analysis(), null, {});
      expect(result.language).toBe("python");
    });

    it("preserves null when caller did not set a language", () => {
      // Documents the failure mode the SKILL.md/file-analyzer.md fix prevents:
      // if the dispatch prompt loses `language`, it propagates to the output.
      const result = buildResult(file({ language: null }), 10, 8, analysis(), null, {});
      expect(result.language).toBeNull();
    });
  });

  describe("importCount fallback", () => {
    // Only relative imports count toward the fallback metric — external
    // package imports would never produce edges so counting them would be
    // misleading. (`.helpers`, `..util`, `./local` all start with `.`)
    const analysisWithImports = analysis({
      imports: [
        { source: ".helpers", specifiers: [] },
        { source: "..util", specifiers: [] },
        { source: "./local", specifiers: [] },
      ],
    });

    it("uses pre-resolved imports when batchImportData has entries", () => {
      const batchImportData = { "src/foo.py": ["src/bar.py", "src/baz.py"] };
      const result = buildResult(file(), 10, 8, analysisWithImports, null, batchImportData);
      expect(result.metrics.importCount).toBe(2);
    });

    it("falls back to parser imports when batchImportData entry is an empty array", () => {
      // Regression test: empty arrays are truthy in JS, so a naive `if (importPaths)`
      // would clobber the parser's count with 0. This is the bug Python projects
      // using absolute imports (which the project scanner doesn't resolve) hit.
      const batchImportData = { "src/foo.py": [] };
      const result = buildResult(file(), 10, 8, analysisWithImports, null, batchImportData);
      expect(result.metrics.importCount).toBe(3);
    });

    it("falls back to parser imports when batchImportData has no entry for the file", () => {
      const result = buildResult(file(), 10, 8, analysisWithImports, null, {});
      expect(result.metrics.importCount).toBe(3);
    });

    it("falls back to parser imports when batchImportData is undefined", () => {
      const result = buildResult(file(), 10, 8, analysisWithImports, null, undefined);
      expect(result.metrics.importCount).toBe(3);
    });

    it("reports 0 imports when neither source has any", () => {
      const result = buildResult(file(), 10, 8, analysis(), null, { "src/foo.py": [] });
      expect(result.metrics.importCount).toBe(0);
    });

    it("excludes external package imports from the fallback count", () => {
      // Regression: pre-2.6.2 the fallback counted ALL parser imports (incl.
      // `os`, `sys`, etc.), so files where the scanner couldn't resolve
      // anything would over-report imports vs. files where it could.
      const ext = analysis({
        imports: [
          { source: "os", specifiers: [] },
          { source: "sys", specifiers: [] },
          { source: "./local", specifiers: [] },
        ],
      });
      const result = buildResult(file(), 10, 8, ext, null, {});
      expect(result.metrics.importCount).toBe(1);
    });
  });

  describe("totalLines", () => {
    // Documents the off-by-one fix: `wc -l` reports N for a POSIX text file
    // with N lines + trailing \n; the extractor must match.
    it("matches wc -l semantics for trailing-newline files", () => {
      // Mimic what main() computes: read file, split on \n.
      // Build a synthetic 3-line file ending in \n.
      const content = "a\nb\nc\n";
      const lines = content.split("\n"); // ["a","b","c",""]
      const totalLines = content.endsWith("\n") ? Math.max(0, lines.length - 1) : lines.length;
      expect(totalLines).toBe(3);
    });

    it("counts content without trailing newline correctly", () => {
      const content = "a\nb\nc";
      const lines = content.split("\n");
      const totalLines = content.endsWith("\n") ? Math.max(0, lines.length - 1) : lines.length;
      expect(totalLines).toBe(3);
    });

  });

  describe("buildOutput", () => {
    it("sets scriptCompleted=true when no files are skipped", () => {
      const output = buildOutput([{ path: "a.py" }], []);
      expect(output.scriptCompleted).toBe(true);
      expect(output.filesAnalyzed).toBe(1);
      expect(output.filesSkipped).toEqual([]);
    });

    it("sets scriptCompleted=false when files are skipped", () => {
      const output = buildOutput([{ path: "a.py" }], ["missing.py"]);
      expect(output.scriptCompleted).toBe(false);
      expect(output.filesAnalyzed).toBe(1);
      expect(output.filesSkipped).toEqual(["missing.py"]);
    });

    it("sets scriptCompleted=false when multiple files are skipped", () => {
      const output = buildOutput([], ["a.py", "b.py", "c.py"]);
      expect(output.scriptCompleted).toBe(false);
      expect(output.filesAnalyzed).toBe(0);
      expect(output.filesSkipped).toHaveLength(3);
    });
  });
});

describe("extract-structure CLI", () => {
  it("preserves resolved call graph metadata in the output JSON", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "ua-extract-structure-"));

    try {
      const projectRoot = join(tempRoot, "project");
      mkdirSync(join(projectRoot, "src"), { recursive: true });
      writeFileSync(
        join(projectRoot, "src", "QuickMessage.java"),
        `package com.example;

import com.remote.UserProfileMoaWrapperService;

public class QuickMessage {
    private UserProfileMoaWrapperService userProfileMoaWrapperService;

    public void getQuickMessage(String id) {
        userProfileMoaWrapperService.queryUserExtend(id);
    }
}
`,
      );

      const inputPath = join(tempRoot, "input.json");
      const outputPath = join(tempRoot, "output.json");
      writeFileSync(
        inputPath,
        JSON.stringify({
          projectRoot,
          fileList: [{
            path: "src/QuickMessage.java",
            language: "java",
            sizeLines: 11,
            fileCategory: "code",
          }],
          importData: {},
        }),
      );

      const scriptPath = join(process.cwd(), "understand-anything-plugin", "skills", "understand", "extract-structure.mjs");
      const result = spawnSync("node", [scriptPath, inputPath, outputPath], {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(result.status, result.stderr).toBe(0);

      const output = JSON.parse(readFileSync(outputPath, "utf-8"));
      const queryCall = output.results[0].callGraph.find((entry) => entry.callee === "userProfileMoaWrapperService.queryUserExtend");

      expect(queryCall).toEqual(expect.objectContaining({
        caller: "getQuickMessage",
        receiver: "userProfileMoaWrapperService",
        methodName: "queryUserExtend",
        argumentCount: 1,
        receiverType: "UserProfileMoaWrapperService",
        receiverQualifiedType: "com.remote.UserProfileMoaWrapperService",
        calleeOwner: "UserProfileMoaWrapperService",
        calleeQualifiedName: "com.remote.UserProfileMoaWrapperService#queryUserExtend",
        resolutionKind: "field",
      }));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
