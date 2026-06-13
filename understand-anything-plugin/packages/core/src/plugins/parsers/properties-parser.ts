import type { AnalyzerPlugin, StructuralAnalysis, SectionInfo } from "../../types.js";

/**
 * Parses Java .properties files to extract key-value pairs as sections.
 * Groups keys by their first segment (e.g., `spring.datasource.url` → `spring`).
 */
export class PropertiesConfigParser implements AnalyzerPlugin {
  name = "properties-config-parser";
  languages = ["properties"];

  analyzeFile(_filePath: string, content: string): StructuralAnalysis {
    const sections = this.extractSections(content);
    return {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      sections,
    };
  }

  private extractSections(content: string): SectionInfo[] {
    const lines = content.split("\n");
    const sections: SectionInfo[] = [];
    const sectionMap = new Map<string, { startLine: number; endLine: number }>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith("#") || line.startsWith("!")) {
        continue;
      }

      // Parse key=value or key:value
      const match = line.match(/^([^=:]+)[=:](.*)$/);
      if (!match) continue;

      const key = match[1].trim();
      const value = match[2].trim();

      // Group by first segment for section grouping
      const firstSegment = key.split(".")[0];

      if (!sectionMap.has(firstSegment)) {
        sectionMap.set(firstSegment, { startLine: i + 1, endLine: i + 1 });
      } else {
        sectionMap.get(firstSegment)!.endLine = i + 1;
      }

      // Add individual key=value as a section for fine-grained search
      sections.push({
        name: `${key}=${value}`,
        level: 2,
        lineRange: [i + 1, i + 1],
      });
    }

    // Add top-level sections
    for (const [name, range] of sectionMap) {
      sections.push({
        name,
        level: 1,
        lineRange: [range.startLine, range.endLine],
      });
    }

    return sections;
  }
}
