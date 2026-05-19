"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// ── Mermaid Diagram Component ─────────────────────────────────────────────────

interface MermaidDiagramProps {
  chart: string;
}

function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
        });
        const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
        const { svg: rendered } = await mermaid.render(id, chart.trim());
        if (!cancelled) {
          setSvg(rendered);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setSvg("");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [chart]);

  if (error) {
    return (
      <div className="p-3 text-xs text-red-400 bg-red-500/10 rounded border border-red-500/20 font-mono whitespace-pre-wrap">
        Mermaid Error: {error}
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="p-3 text-xs text-[var(--text-tertiary)] bg-[var(--surface-secondary)] rounded animate-pulse">
        Rendering diagram...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ── Wiki Markdown Renderer ─────────────────────────────────────────────────

interface WikiMarkdownProps {
  content: string;
  onWikilinkClick?: (target: string) => void;
}

function preprocessWikiMarkdown(raw: string): string {
  const content = raw.replace(/^---\n[\s\S]*?---\n/, "");
  return content.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g,
    (_, target: string, alias: string) =>
      `[${alias || target}](wiki:${target.trim()})`,
  );
}

export function WikiMarkdown({ content, onWikilinkClick }: WikiMarkdownProps) {
  const processed = preprocessWikiMarkdown(content);

  const components = useMemo(
    () => ({
      a: ({
        children,
        href,
        ...props
      }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
        children?: React.ReactNode;
      }) => {
        if (href?.startsWith("wiki:")) {
          const target = decodeURIComponent(href.slice(5));
          return (
            <span
              className="text-[var(--brand-primary)] underline decoration-dotted cursor-pointer hover:opacity-80 transition-opacity"
              role="button"
              tabIndex={0}
              onClick={() => onWikilinkClick?.(target)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onWikilinkClick?.(target);
              }}
            >
              {children}
            </span>
          );
        }
        return (
          <a target="_blank" rel="noopener noreferrer" href={href} {...props}>
            {children}
          </a>
        );
      },
      code: ({
        className,
        children,
        ...props
      }: React.HTMLAttributes<HTMLElement> & {
        children?: React.ReactNode;
      }) => {
        const match = /language-(\w+)/.exec(className || "");
        const lang = match?.[1];
        const value = String(children).replace(/\n$/, "");

        // Mermaid diagram rendering
        if (lang === "mermaid") {
          return <MermaidDiagram chart={value} />;
        }

        // Inline code (no language class)
        if (!className) {
          return (
            <code className="px-1 py-0.5 text-xs bg-[var(--surface-secondary)] rounded font-mono" {...props}>
              {children}
            </code>
          );
        }

        // Fenced code block with language
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
    }),
    [onWikilinkClick],
  );

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none wiki-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
