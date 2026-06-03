import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useDashboardStore } from "../store";
import { serviceOverviewToMarkdown, domainPageToMarkdown } from "../utils/wikiToMarkdown";
import type { WikiDomainPage, WikiServiceOverview } from "@understand-anything/core";

function WikiNavTree({
  index,
  activePage,
  onSelect,
}: {
  index: { entries: Array<{ id: string; name: string; type: string; summary: string }> };
  activePage: { type: "service" | "domain"; id: string } | null;
  onSelect: (page: { type: "service" | "domain"; id: string }) => void;
}) {
  const serviceEntries = index.entries.filter((e) => e.type === "service" || e.type === "overview");
  const domainEntries = index.entries.filter((e) => e.type === "domain");

  return (
    <nav className="w-64 min-w-[200px] border-r border-border overflow-y-auto p-3 flex flex-col gap-1">
      <h3 className="text-[10px] uppercase tracking-wider text-text-muted mb-2 px-2">Wiki</h3>

      {serviceEntries.length > 0 && (
        <div className="mb-3">
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1 px-2">Service</h4>
          {serviceEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect({ type: "service", id: entry.id })}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                activePage?.type === "service" && activePage?.id === entry.id
                  ? "bg-accent/20 text-accent"
                  : "hover:bg-surface-hover text-text"
              }`}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}

      {domainEntries.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1 px-2">Domains</h4>
          {domainEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect({ type: "domain", id: entry.id })}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                activePage?.type === "domain" && activePage?.id === entry.id
                  ? "bg-accent/20 text-accent"
                  : "hover:bg-surface-hover text-text"
              }`}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}

function WikiContent({
  content,
  pageType,
  loading,
}: {
  content: unknown | null;
  pageType: "service" | "domain" | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Loading...
      </div>
    );
  }

  if (!content || !pageType) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Select a page from the navigation tree.
      </div>
    );
  }

  const markdown =
    pageType === "service"
      ? serviceOverviewToMarkdown(content as WikiServiceOverview)
      : domainPageToMarkdown(content as WikiDomainPage);

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-3xl">
      <article className="prose prose-sm prose-invert max-w-none wiki-markdown">
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </article>
    </div>
  );
}

export default function WikiView({ accessToken }: { accessToken: string }) {
  const wikiIndex = useDashboardStore((s) => s.wikiIndex);
  const wikiActivePage = useDashboardStore((s) => s.wikiActivePage);
  const wikiPageContent = useDashboardStore((s) => s.wikiPageContent);
  const wikiLoading = useDashboardStore((s) => s.wikiLoading);
  const setWikiIndex = useDashboardStore((s) => s.setWikiIndex);
  const setWikiActivePage = useDashboardStore((s) => s.setWikiActivePage);
  const setWikiPageContent = useDashboardStore((s) => s.setWikiPageContent);
  const setWikiLoading = useDashboardStore((s) => s.setWikiLoading);

  const [searchQuery, setSearchQuery] = useState("");

  const dataUrl = useCallback(
    (path: string) => `/wiki/${path}?token=${encodeURIComponent(accessToken)}`,
    [accessToken],
  );

  useEffect(() => {
    if (wikiIndex) return;
    fetch(dataUrl("index.json"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.entries) setWikiIndex(data);
      })
      .catch(() => {});
  }, [dataUrl, wikiIndex, setWikiIndex]);

  useEffect(() => {
    if (!wikiActivePage) {
      setWikiPageContent(null);
      return;
    }
    setWikiLoading(true);
    const filePath =
      wikiActivePage.type === "service"
        ? "service.json"
        : `domains/${wikiActivePage.id}.json`;

    fetch(dataUrl(filePath))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setWikiPageContent(data);
        setWikiLoading(false);
      })
      .catch(() => {
        setWikiPageContent(null);
        setWikiLoading(false);
      });
  }, [wikiActivePage, dataUrl, setWikiPageContent, setWikiLoading]);

  const handleSelect = useCallback(
    (page: { type: "service" | "domain"; id: string }) => {
      setWikiActivePage(page);
    },
    [setWikiActivePage],
  );

  const filteredIndex = wikiIndex
    ? {
        entries: searchQuery.trim()
          ? wikiIndex.entries.filter(
              (e) =>
                e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                e.summary.toLowerCase().includes(searchQuery.toLowerCase()),
            )
          : wikiIndex.entries,
      }
    : null;

  if (!wikiIndex) {
    return (
      <div className="w-full h-full flex items-center justify-center text-text-muted text-sm">
        Loading Wiki index...
      </div>
    );
  }

  return (
    <div className="w-full h-full flex bg-root">
      <div className="flex flex-col border-r border-border">
        <div className="p-2 border-b border-border">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search wiki..."
            className="w-full px-2 py-1 text-xs rounded bg-surface border border-border text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        {filteredIndex && (
          <WikiNavTree
            index={filteredIndex}
            activePage={wikiActivePage}
            onSelect={handleSelect}
          />
        )}
      </div>
      <WikiContent
        content={wikiPageContent}
        pageType={wikiActivePage?.type ?? null}
        loading={wikiLoading}
      />
    </div>
  );
}
