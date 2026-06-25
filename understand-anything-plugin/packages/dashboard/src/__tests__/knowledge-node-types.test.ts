import { describe, expect, it } from "vitest";

import { NODE_TYPE_TO_CATEGORY } from "../components/GraphView";
import {
  isKnowledgeGraphNodeType,
  KNOWLEDGE_NODE_TYPES,
} from "../components/KnowledgeGraphView";
import { isKnowledgeNode, typeBadgeColors } from "../components/NodeInfo";

describe("dashboard knowledge node type coverage", () => {
  it("classifies requirement and testcase nodes as knowledge", () => {
    expect(NODE_TYPE_TO_CATEGORY.requirement).toBe("knowledge");
    expect(NODE_TYPE_TO_CATEGORY.testcase).toBe("knowledge");
    expect(KNOWLEDGE_NODE_TYPES).toEqual(
      expect.arrayContaining(["requirement", "testcase"]),
    );
    expect(isKnowledgeGraphNodeType("requirement")).toBe(true);
    expect(isKnowledgeGraphNodeType("testcase")).toBe(true);
    expect(isKnowledgeNode("requirement")).toBe(true);
    expect(isKnowledgeNode("testcase")).toBe(true);
  });

  it("defines NodeInfo badge colors for requirement and testcase nodes", () => {
    expect(typeBadgeColors.requirement).toContain("node-requirement");
    expect(typeBadgeColors.testcase).toContain("node-testcase");
  });
});
