import { useCallback, useEffect, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { MermaidDiagram } from "./MermaidDiagram";
import { useDashboardStore } from "../store";

function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return text;
  return text.slice(end + 4).trimStart();
}

type ContentState =
  | { status: "idle" | "loading"; content: null; error: null }
  | { status: "loaded"; content: string; error: null }
  | { status: "error"; content: null; error: string };

function sourceUrl(file: string, service?: string | null): string {
  const params = new URLSearchParams({ file, mode: "wiki" });
  if (service) params.set("service", service);
  return `/api/source?${params.toString()}`;
}

export default function WikiContentViewer() {
  const filePath = useDashboardStore((s) => s.wikiViewerFilePath);
  const closeWikiViewer = useDashboardStore((s) => s.closeWikiViewer);
  const openWikiViewer = useDashboardStore((s) => s.openWikiViewer);
  const activeService = useDashboardStore((s) => s.activeService);
  const [state, setState] = useState<ContentState>({
    status: "idle",
    content: null,
    error: null,
  });

  useEffect(() => {
    if (!filePath) {
      setState({ status: "idle", content: null, error: null });
      return;
    }
    setState({ status: "loading", content: null, error: null });
    fetch(sourceUrl(filePath, activeService))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const text = stripFrontmatter(data.content || data.source || "");
        setState({ status: "loaded", content: text, error: null });
      })
      .catch((e) =>
        setState({ status: "error", content: null, error: e.message }),
      );
  }, [filePath, activeService]);

  const handleLinkClick = useCallback(
    (href: string) => {
      if (!href || href.startsWith("http://") || href.startsWith("https://"))
        return;
      let cleanHref: string;
      try { cleanHref = decodeURIComponent(href.split("#")[0]); } catch { cleanHref = href.split("#")[0]; }
      if (!cleanHref) return;

      const ROOT_PREFIXES = ["raw/", "wiki/", "outputs/", "audit/", "log/", "scripts/"];
      const isRootRelative = ROOT_PREFIXES.some((p) => cleanHref.startsWith(p));

      if (isRootRelative) {
        openWikiViewer(cleanHref);
        return;
      }

      if (filePath) {
        const currentDir = filePath.includes("/")
          ? filePath.slice(0, filePath.lastIndexOf("/"))
          : "";
        let resolved = cleanHref;
        if (cleanHref.startsWith("../")) {
          const parts = currentDir.split("/");
          let target = cleanHref;
          while (target.startsWith("../")) {
            parts.pop();
            target = target.slice(3);
          }
          resolved = parts.length > 0 ? `${parts.join("/")}/${target}` : target;
        } else if (!cleanHref.startsWith("/")) {
          resolved = currentDir ? `${currentDir}/${cleanHref}` : cleanHref;
        }
        openWikiViewer(resolved);
      }
    },
    [filePath, openWikiViewer],
  );

  const displayPath = filePath ?? "";

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface/80 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded text-node-article border border-node-article/30 bg-node-article/10">
            Wiki
          </span>
          <span
            className="text-xs font-mono text-text-secondary truncate"
            title={displayPath}
          >
            {displayPath}
          </span>
        </div>
        <button
          type="button"
          onClick={closeWikiViewer}
          className="text-text-muted hover:text-text-primary transition-colors p-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {state.status === "loading" && (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            Loading...
          </div>
        )}
        {state.status === "error" && (
          <div className="flex items-center justify-center h-full text-red-400 text-sm">
            {state.error}
          </div>
        )}
        {state.status === "loaded" && (
          <div className="wiki-markdown max-w-none p-6">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              urlTransform={(url) => {
                if (!url || url.startsWith("#")) return url;
                if (
                  /^[a-z][a-z0-9+.-]*:/i.test(url) &&
                  !url.startsWith("http://") &&
                  !url.startsWith("https://")
                ) {
                  return "";
                }
                return defaultUrlTransform(url);
              }}
              components={{
                a: ({ href, children, ...props }) => (
                  <a
                    {...props}
                    href={href}
                    onClick={(e) => {
                      if (
                        href &&
                        !href.startsWith("http://") &&
                        !href.startsWith("https://")
                      ) {
                        e.preventDefault();
                        handleLinkClick(href);
                      }
                    }}
                    className="text-accent hover:underline cursor-pointer"
                  >
                    {children}
                  </a>
                ),
                code: ({ className, children, ...props }) => {
                  const match = /language-(\w+)/.exec(className || "");
                  if (match?.[1] === "mermaid") {
                    return <MermaidDiagram content={String(children).trim()} />;
                  }
                  if (match) {
                    return (
                      <pre className="bg-gray-900 rounded p-3 overflow-x-auto">
                        <code className={className} {...props}>
                          {children}
                        </code>
                      </pre>
                    );
                  }
                  return (
                    <code
                      className="bg-gray-800 rounded px-1 py-0.5 text-[12px]"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
              }}
            >
              {state.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
