// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core/types";

import { NODE_TYPE_TO_CATEGORY } from "../components/GraphView";
import {
  EDGE_STYLES,
  isKnowledgeGraphNodeType,
  KNOWLEDGE_NODE_TYPES,
} from "../components/KnowledgeGraphView";
import NodeInfo, { isKnowledgeNode, typeBadgeColors } from "../components/NodeInfo";
import { typeBadgeColors as searchTypeBadgeColors } from "../components/SearchBar";
import { I18nProvider } from "../contexts/I18nContext";
import { useDashboardStore } from "../store";

describe("dashboard knowledge node type coverage", () => {
  afterEach(() => {
    cleanup();
    useDashboardStore.setState({
      graph: null,
      selectedNodeId: null,
      viewMode: "structural",
      domainGraph: null,
      nodeHistory: [],
    });
  });

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

  it("defines SearchBar badge colors for requirement and testcase nodes", () => {
    expect(searchTypeBadgeColors.requirement).toContain("node-requirement");
    expect(searchTypeBadgeColors.testcase).toContain("node-testcase");
  });

  it("styles tested_by edges as testcase coverage links", () => {
    expect(EDGE_STYLES.tested_by).toMatchObject({
      stroke: "var(--color-node-testcase)",
      strokeWidth: 2,
      strokeDasharray: "2 4",
    });
  });

  it("renders PRD metadata and coverage details for knowledge nodes", () => {
    const graph: KnowledgeGraph = {
      version: "1.0",
      project: {
        name: "test",
        languages: [],
        frameworks: [],
        description: "",
        analyzedAt: "2026-06-25T00:00:00.000Z",
        gitCommitHash: "test",
      },
      nodes: [
        {
          id: "requirement:pk",
          type: "requirement",
          name: "跨房间 PK",
          summary: "房间 PK 需求",
          tags: [],
          complexity: "simple",
          knowledgeMeta: {
            business: "房间",
            version: "v2.25.0",
            month: "2025-10",
            detail: "跨房间 PK",
            sourceType: "prd",
            sourcePath: "raw/prd/房间/pk.md",
            content: "需求正文",
          },
        },
        {
          id: "testcase:pk",
          type: "testcase",
          name: "PK 测试",
          summary: "测试覆盖",
          tags: [],
          complexity: "simple",
        },
        {
          id: "source:pk",
          type: "source",
          name: "PRD 原文",
          summary: "原始来源",
          tags: [],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "requirement:pk",
          target: "testcase:pk",
          type: "tested_by",
          direction: "forward",
          weight: 1,
        },
        {
          source: "requirement:pk",
          target: "source:pk",
          type: "cites",
          direction: "forward",
          weight: 1,
        },
      ],
      layers: [],
      tour: [],
    };

    useDashboardStore.setState({
      graph,
      selectedNodeId: "requirement:pk",
      viewMode: "knowledge",
      domainGraph: null,
      nodeHistory: [],
    });

    render(createElement(I18nProvider, {
      language: "zh",
      children: createElement(NodeInfo),
    }));

    expect(screen.getByText("房间")).toBeTruthy();
    expect(screen.getByText("v2.25.0")).toBeTruthy();
    expect(screen.getAllByText("跨房间 PK").length).toBeGreaterThan(0);
    expect(screen.getByText("raw/prd/房间/pk.md")).toBeTruthy();
    expect(screen.getAllByText("PK 测试").length).toBeGreaterThan(0);
    expect(screen.getByText("原始 PRD")).toBeTruthy();
  });
});
