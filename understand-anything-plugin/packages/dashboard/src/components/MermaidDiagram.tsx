import { useEffect, useRef, useState } from "react";

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: {
          primaryColor: "#d4a574",
          primaryTextColor: "#f5f0eb",
          primaryBorderColor: "rgba(212, 165, 116, 0.25)",
          lineColor: "rgba(212, 165, 116, 0.3)",
          secondaryColor: "#1a1a1a",
          tertiaryColor: "#111111",
          background: "#0a0a0a",
          mainBkg: "#1a1a1a",
          nodeBorder: "rgba(212, 165, 116, 0.25)",
          clusterBkg: "#141414",
          titleColor: "#e8c49a",
          edgeLabelBackground: "#1a1a1a",
        },
      });
      return mod;
    });
  }
  return mermaidPromise;
}

let renderCounter = 0;

export function MermaidDiagram({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${++renderCounter}`;

    loadMermaid()
      .then(({ default: mermaid }) => mermaid.render(id, content.trim()))
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [content]);

  if (error) {
    return (
      <div className="mermaid-container">
        <div className="mermaid-error">Diagram render failed: {error}</div>
        <pre>
          <code>{content}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="mermaid-container">
      {loading && <div className="mermaid-loading">Loading diagram…</div>}
      <div ref={containerRef} />
    </div>
  );
}
