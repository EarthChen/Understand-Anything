import { useCallback, useEffect, useState } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import { MermaidDiagram } from "./MermaidDiagram"

interface TreeNode {
  id: string
  name: string
  type: string
  filePath: string
  summary: string
}

interface KnowledgeTree {
  service: string
  tree: Record<string, TreeNode[]>
  totalNodes: number
}

const TYPE_COLORS: Record<string, string> = {
  requirement: "#d99058",
  testcase: "#8dbf73",
  article: "#6fa8dc",
  entity: "#b4a7d6",
  topic: "#e06666",
  source: "#999999",
}

function sourceUrl(file: string, service: string): string {
  const params = new URLSearchParams({ file, mode: "wiki", service })
  return `/api/source?${params.toString()}`
}

export function KnowledgeWikiView({ serviceName }: { serviceName: string }) {
  const [tree, setTree] = useState<KnowledgeTree | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [content, setContent] = useState<string>("")
  const [contentLoading, setContentLoading] = useState(false)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/wiki/knowledge-tree?service=${encodeURIComponent(serviceName)}`)
      .then((r) => r.json())
      .then((data) => {
        setTree(data)
        const dirs = new Set(Object.keys(data.tree || {}))
        setExpandedDirs(dirs)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [serviceName])

  const loadContent = useCallback(
    (filePath: string) => {
      setSelectedFile(filePath)
      setContentLoading(true)
      fetch(sourceUrl(filePath, serviceName))
        .then((r) => r.json())
        .then((data) => setContent(data.content || data.source || ""))
        .catch(() => setContent("Failed to load content"))
        .finally(() => setContentLoading(false))
    },
    [serviceName],
  )

  const toggleDir = useCallback((dir: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }, [])

  const handleLinkClick = useCallback(
    (href: string) => {
      if (!href || href.startsWith("http://") || href.startsWith("https://")) return
      const cleanHref = href.split("#")[0]
      if (!cleanHref) return

      if (selectedFile) {
        const currentDir = selectedFile.includes("/")
          ? selectedFile.slice(0, selectedFile.lastIndexOf("/"))
          : ""
        let resolved = cleanHref
        if (cleanHref.startsWith("../")) {
          const parts = currentDir.split("/")
          let target = cleanHref
          while (target.startsWith("../")) {
            parts.pop()
            target = target.slice(3)
          }
          resolved = parts.length > 0 ? `${parts.join("/")}/${target}` : target
        } else if (!cleanHref.startsWith("/")) {
          resolved = currentDir ? `${currentDir}/${cleanHref}` : cleanHref
        }
        loadContent(resolved)
      }
    },
    [selectedFile, loadContent],
  )

  if (loading) {
    return <div className="flex items-center justify-center h-full text-text-muted">Loading knowledge tree...</div>
  }

  if (error) {
    return <div className="flex items-center justify-center h-full text-red-400">{error}</div>
  }

  if (!tree || tree.totalNodes === 0) {
    return <div className="flex items-center justify-center h-full text-text-muted">No knowledge nodes found for {serviceName}</div>
  }

  const sortedDirs = Object.keys(tree.tree).sort()

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-64 min-w-48 border-r border-border overflow-y-auto bg-surface/50">
        <div className="px-3 py-2 border-b border-border">
          <div className="text-xs font-medium text-text">{serviceName}</div>
          <div className="text-[10px] text-text-muted">{tree.totalNodes} nodes</div>
        </div>
        {sortedDirs.map((dir) => (
          <div key={dir}>
            <button
              type="button"
              className="w-full px-3 py-1.5 text-left text-[11px] font-medium text-text-muted hover:bg-surface flex items-center gap-1"
              onClick={() => toggleDir(dir)}
            >
              <span className="text-[10px]">{expandedDirs.has(dir) ? "▼" : "▶"}</span>
              <span className="truncate">{dir === "(root)" ? "/ (root)" : dir}</span>
              <span className="text-[9px] ml-auto opacity-60">{tree.tree[dir].length}</span>
            </button>
            {expandedDirs.has(dir) &&
              tree.tree[dir].map((node) => (
                <button
                  type="button"
                  key={node.id}
                  className={`w-full px-5 py-1 text-left text-[11px] hover:bg-surface/80 truncate flex items-center gap-1.5 ${
                    selectedFile === node.filePath ? "bg-accent/10 text-accent" : "text-text"
                  }`}
                  onClick={() => loadContent(node.filePath)}
                  title={node.summary}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: TYPE_COLORS[node.type] || "#888" }}
                  />
                  <span className="truncate">{node.name}</span>
                </button>
              ))}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {!selectedFile ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            Select a page from the tree to preview
          </div>
        ) : contentLoading ? (
          <div className="flex items-center justify-center h-full text-text-muted">Loading...</div>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none p-6">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              urlTransform={(url) => {
                if (url.startsWith("http://") || url.startsWith("https://")) return defaultUrlTransform(url)
                return url
              }}
              components={{
                a: ({ href, children, ...props }) => (
                  <a
                    {...props}
                    href={href}
                    onClick={(e) => {
                      if (href && !href.startsWith("http://") && !href.startsWith("https://")) {
                        e.preventDefault()
                        handleLinkClick(href)
                      }
                    }}
                    className="text-accent hover:underline cursor-pointer"
                  >
                    {children}
                  </a>
                ),
                code: ({ className, children, ...props }) => {
                  const match = /language-(\w+)/.exec(className || "")
                  if (match?.[1] === "mermaid") {
                    return <MermaidDiagram content={String(children).trim()} />
                  }
                  if (match) {
                    return (
                      <pre className="bg-gray-900 rounded p-3 overflow-x-auto">
                        <code className={className} {...props}>
                          {children}
                        </code>
                      </pre>
                    )
                  }
                  return (
                    <code className="bg-gray-800 rounded px-1 py-0.5 text-[12px]" {...props}>
                      {children}
                    </code>
                  )
                },
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
