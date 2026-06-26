import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDashboardStore } from "../store";
import type { WikiSearchResult } from "@understand-anything/core/types";
import { useI18n } from "../contexts/I18nContext";

export const typeBadgeColors: Record<string, string> = {
  file: "text-node-file border border-node-file/30 bg-node-file/10",
  function: "text-node-function border border-node-function/30 bg-node-function/10",
  class: "text-node-class border border-node-class/30 bg-node-class/10",
  module: "text-node-module border border-node-module/30 bg-node-module/10",
  concept: "text-node-concept border border-node-concept/30 bg-node-concept/10",
  config: "text-node-config border border-node-config/30 bg-node-config/10",
  document: "text-node-document border border-node-document/30 bg-node-document/10",
  service: "text-node-service border border-node-service/30 bg-node-service/10",
  table: "text-node-table border border-node-table/30 bg-node-table/10",
  endpoint: "text-node-endpoint border border-node-endpoint/30 bg-node-endpoint/10",
  pipeline: "text-node-pipeline border border-node-pipeline/30 bg-node-pipeline/10",
  schema: "text-node-schema border border-node-schema/30 bg-node-schema/10",
  resource: "text-node-resource border border-node-resource/30 bg-node-resource/10",
  domain: "text-node-concept border border-node-concept/30 bg-node-concept/10",
  flow: "text-node-pipeline border border-node-pipeline/30 bg-node-pipeline/10",
  step: "text-node-function border border-node-function/30 bg-node-function/10",
  article: "text-node-article border border-node-article/30 bg-node-article/10",
  entity: "text-node-entity border border-node-entity/30 bg-node-entity/10",
  topic: "text-node-topic border border-node-topic/30 bg-node-topic/10",
  claim: "text-node-claim border border-node-claim/30 bg-node-claim/10",
  source: "text-node-source border border-node-source/30 bg-node-source/10",
  requirement: "text-node-requirement border border-node-requirement/30 bg-node-requirement/10",
  testcase: "text-node-testcase border border-node-testcase/30 bg-node-testcase/10",
  overview: "text-amber-400 border border-amber-400/30 bg-amber-400/10",
  architecture: "text-amber-400 border border-amber-400/30 bg-amber-400/10",
};

function resolveWikiPage(result: WikiSearchResult): { type: "service" | "domain" | "overview" | "architecture" | "cross-domain"; id: string; service?: string } {
  const t = result.type;
  if (t === "overview" || t === "architecture" || t === "service") {
    return { type: t, id: result.id, service: result.service };
  }
  if (t === "domain") {
    const domainId = result.id.startsWith("domain:") ? result.id : `domain:${result.id}`;
    return { type: "domain", id: domainId, service: result.service };
  }
  if (result.domain) {
    const domainId = result.domain.startsWith("domain:") ? result.domain : `domain:${result.domain}`;
    return { type: "domain", id: domainId, service: result.service };
  }
  if (t === "flow" || t === "step") {
    return { type: "service" as const, id: result.service ?? result.id, service: result.service };
  }
  return { type: "domain", id: result.id, service: result.service };
}

export default function SearchBar() {
  const searchQuery = useDashboardStore((s) => s.searchQuery);
  const searchResults = useDashboardStore((s) => s.searchResults);
  const wikiSearchResults = useDashboardStore((s) => s.wikiSearchResults);
  const serverKgResults = useDashboardStore((s) => s.serverKgResults);
  const graph = useDashboardStore((s) => s.graph);
  const setSearchQuery = useDashboardStore((s) => s.setSearchQuery);
  const navigateToNodeInLayer = useDashboardStore((s) => s.navigateToNodeInLayer);
  const searchMode = useDashboardStore((s) => s.searchMode);
  const setSearchMode = useDashboardStore((s) => s.setSearchMode);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const { t } = useI18n();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build a lookup map for node details
  const nodeMap = useMemo(
    () => new Map((graph?.nodes ?? []).map((n) => [n.id, n])),
    [graph],
  );

  const topResults = searchResults.slice(0, 5);
  const topWikiResults = wikiSearchResults.slice(0, 5);
  const localNodeIds = new Set(topResults.map((r) => r.nodeId));
  const topServerKgResults = serverKgResults.filter((r) => !localNodeIds.has(r.id)).slice(0, 5);
  const hasResults = topResults.length > 0 || topWikiResults.length > 0 || topServerKgResults.length > 0;

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
      setDropdownOpen(true);
    },
    [setSearchQuery],
  );

  const handleResultClick = useCallback(
    (nodeId: string) => {
      const store = useDashboardStore.getState();
      const currentGraph = store.graph;
      const currentIsKG = store.isKnowledgeGraph;
      const currentViewMode = store.viewMode;

      if (currentIsKG && currentGraph) {
        const node = currentGraph.nodes.find((n) => n.id === nodeId);
        if (node?.filePath) {
          const updates: Record<string, unknown> = {
            viewMode: "wiki",
            knowledgeWikiSelectedFile: node.filePath,
            selectedNodeId: null,
            focusNodeId: null,
            codeViewerOpen: false,
            codeViewerNodeId: null,
            codeViewerExpanded: false,
            wikiViewerOpen: false,
            wikiViewerFilePath: null,
          };
          if (!store.activeService && store.systemGraph) {
            const services = Object.keys(store.systemGraph.serviceIndex);
            const kgSvc = services.find(
              (s) => store.systemGraph!.serviceIndex[s].facet === "knowledge"
                || store.systemGraph!.serviceIndex[s].profile === "prd-wiki",
            ) ?? services.find((s) => store.systemGraph!.serviceIndex[s].hasKg);
            if (kgSvc) updates.activeService = kgSvc;
          }
          useDashboardStore.setState(updates);
          setDropdownOpen(false);
          return;
        }
      }
      if (currentViewMode === "wiki" || currentViewMode === "system") {
        setViewMode(currentIsKG ? "knowledge" : "structural");
      }
      navigateToNodeInLayer(nodeId);
      setDropdownOpen(false);
    },
    [navigateToNodeInLayer, setViewMode],
  );


  const handleWikiResultClick = useCallback(
    (result: WikiSearchResult) => {
      const store = useDashboardStore.getState();
      const page = resolveWikiPage(result);
      const updates: Record<string, unknown> = {
        viewMode: "wiki",
        wikiActivePage: page,
        selectedNodeId: null,
        focusNodeId: null,
        codeViewerOpen: false,
        codeViewerNodeId: null,
        codeViewerExpanded: false,
        wikiViewerOpen: false,
        wikiViewerFilePath: null,
      };
      if (store.isKnowledgeGraph) {
        updates.isKnowledgeGraph = false;
      }
      if (result.service && result.service !== store.activeService) {
        updates.activeService = result.service;
      } else if (!result.service && store.activeService) {
        updates.activeService = null;
      }
      useDashboardStore.setState(updates);
      setDropdownOpen(false);
    },
    [],
  );

  const handleServerKgClick = useCallback(
    (result: { id: string; name: string; type: string; service?: string; filePath?: string }) => {
      if (result.filePath && result.service) {
        useDashboardStore.setState({
          activeService: result.service,
          isKnowledgeGraph: true,
          viewMode: "wiki" as const,
          knowledgeWikiSelectedFile: result.filePath,
          selectedNodeId: null,
          focusNodeId: null,
          codeViewerOpen: false,
          codeViewerNodeId: null,
          codeViewerExpanded: false,
          wikiViewerOpen: false,
          wikiViewerFilePath: null,
        });
      } else if (result.service) {
        useDashboardStore.setState({
          activeService: result.service,
          viewMode: "knowledge" as const,
          isKnowledgeGraph: true,
          selectedNodeId: null,
          focusNodeId: null,
        });
      }
      setDropdownOpen(false);
    },
    [],
  );

  // Close dropdown on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const showDropdown = dropdownOpen && searchQuery.trim() && hasResults;

  return (
    <div ref={containerRef} className="relative z-30">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-surface border-b border-border-subtle">
        <svg
          className="w-4 h-4 text-text-muted shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          onFocus={() => setDropdownOpen(true)}
          placeholder={t.search.placeholder}
          data-testid="search-input"
          className="flex-1 min-w-0 bg-elevated text-text-primary text-sm rounded-lg px-3 py-1.5 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted"
        />
        <div className="flex items-center gap-1 bg-elevated rounded-lg p-0.5 shrink-0">
          <button
            onClick={() => setSearchMode("fuzzy")}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              searchMode === "fuzzy"
                ? "bg-accent/20 text-accent"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {t.search.fuzzy}
          </button>
          <button
            onClick={() => setSearchMode("semantic")}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              searchMode === "semantic"
                ? "bg-accent/20 text-accent"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {t.search.semantic}
          </button>
        </div>
        {searchQuery.trim() && (
          <span className="hidden sm:inline text-xs text-text-muted shrink-0">
            {searchResults.length + serverKgResults.length + wikiSearchResults.length} {t.search.result}{(searchResults.length + serverKgResults.length + wikiSearchResults.length) !== 1 ? "s" : ""}{" "}
            <span className="text-text-muted">({searchMode})</span>
          </span>
        )}
      </div>

      {/* Dropdown results */}
      {showDropdown && (
        <div className="absolute left-4 right-4 top-full mt-0.5 glass rounded-lg shadow-xl overflow-hidden max-h-80 overflow-y-auto">
          {/* Graph node results */}
          {topResults.map((result) => {
            const node = nodeMap.get(result.nodeId);
            if (!node) return null;

            const relevance = Math.round((1 - result.score) * 100);
            const badgeColor = typeBadgeColors[node.type] ?? typeBadgeColors.file;

            return (
              <button
                key={result.nodeId}
                type="button"
                onClick={() => handleResultClick(result.nodeId)}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-elevated transition-colors text-left"
              >
                {/* Type badge */}
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${badgeColor} shrink-0`}
                >
                  {node.type}
                </span>

                {/* Node name */}
                <span className="text-sm text-text-primary truncate flex-1">
                  {node.name}
                </span>

                {/* Relevance bar */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-16 h-1.5 bg-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full"
                      style={{ width: `${relevance}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-text-muted w-7 text-right">
                    {relevance}%
                  </span>
                </div>
              </button>
            );
          })}

          {/* Server KG results (cross-service) */}
          {topServerKgResults.length > 0 && (
            <>
              {topResults.length > 0 && (
                <div className="border-t border-border-subtle" />
              )}
              <div className="px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Knowledge Graph
                </span>
              </div>
              {topServerKgResults.map((result) => {
                const relevance = Math.round(result.score * 100);
                const badgeColor = typeBadgeColors[result.type] ?? typeBadgeColors.article;
                return (
                  <button
                    key={`skg:${result.id}`}
                    type="button"
                    onClick={() => handleServerKgClick(result)}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-elevated transition-colors text-left"
                  >
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${badgeColor} shrink-0`}>
                      {result.type}
                    </span>
                    <span className="text-sm text-text-primary truncate flex-1">
                      {result.name}
                    </span>
                    {result.service && (
                      <span className="text-[10px] text-text-muted shrink-0">
                        {result.service}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="w-16 h-1.5 bg-elevated rounded-full overflow-hidden">
                        <div className="h-full bg-green-400 rounded-full" style={{ width: `${relevance}%` }} />
                      </div>
                      <span className="text-[10px] text-text-muted w-7 text-right">{relevance}%</span>
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {/* Wiki results section */}
          {topWikiResults.length > 0 && (
            <>
              {(topResults.length > 0 || topServerKgResults.length > 0) && (
                <div className="border-t border-border-subtle" />
              )}
              <div className="px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  {t.search.wikiResults}
                </span>
              </div>
              {topWikiResults.map((result) => {
                const relevance = Math.round(Math.min(result.score, 100));
                const badgeColor = typeBadgeColors[result.type] ?? typeBadgeColors.domain;

                return (
                  <button
                    key={`wiki:${result.id}`}
                    type="button"
                    onClick={() => handleWikiResultClick(result)}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-elevated transition-colors text-left"
                  >
                    {/* Type badge */}
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${badgeColor} shrink-0`}
                    >
                      {result.type}
                    </span>

                    {/* Name + summary */}
                    <span className="text-sm text-text-primary truncate flex-1">
                      {result.name}
                    </span>

                    {/* Relevance bar */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="w-16 h-1.5 bg-elevated rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-400 rounded-full"
                          style={{ width: `${relevance}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-text-muted w-7 text-right">
                        {relevance}%
                      </span>
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
