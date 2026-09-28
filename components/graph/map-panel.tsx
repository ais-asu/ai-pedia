"use client";

import { ArrowLeft, ArrowUpRight, Pencil, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import NotebookRenderer from "@/components/NotebookRenderer";
import type { ArticlePayload } from "@/lib/article-payload";
import type { GraphNode } from "@/lib/graph-types";
import { NodeImage } from "./node-image";

/**
 * The glass panel an article opens in beside the map.
 *
 * It starts narrow, as a summary — header image, title, description — and
 * widens on "View full article" to the full text, fetched from the statically
 * generated article endpoint and rendered by the same renderers the article
 * page uses, followed by the rest of the branch.
 */

const cache = new Map<string, ArticlePayload>();

function endpointFor(href: string): string | null {
  const match = href.match(/^\/learn\/([^/]+)\/([^/]+)$/);
  return match ? `/api/article/${match[1]}/${match[2]}` : null;
}

function useArticle(href: string, enabled: boolean) {
  const [article, setArticle] = useState<ArticlePayload | null>(
    () => cache.get(href) ?? null,
  );
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const cached = cache.get(href);
    if (cached) {
      setArticle(cached);
      setError(false);
      return;
    }
    const endpoint = endpointFor(href);
    if (!endpoint) {
      setError(true);
      return;
    }
    let live = true;
    setArticle(null);
    setError(false);
    fetch(endpoint)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<ArticlePayload>;
      })
      .then((payload) => {
        cache.set(href, payload);
        if (live) setArticle(payload);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [href, enabled]);

  return { article, error };
}

export function MapPanel({
  node,
  branch,
  related,
  expanded,
  width,
  onExpand,
  onCollapse,
  onClose,
  onSelect,
}: {
  node: GraphNode;
  branch?: GraphNode;
  related: GraphNode[];
  expanded: boolean;
  width: number;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
  onSelect: (node: GraphNode) => void;
}) {
  const href = node.href ?? "/";
  const { article, error } = useArticle(href, expanded);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  // Move focus into the panel so Escape and scrolling land here, not the map.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  // A new article, or a change of mode, starts at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies(node.id): scroll resets whenever the article changes
  // biome-ignore lint/correctness/useExhaustiveDependencies(expanded): …or the panel changes mode
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [node.id, expanded]);

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label={node.label}
      className="nmap-panel"
      style={{ width }}
    >
      <header className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
        {expanded ? (
          <button type="button" onClick={onCollapse} className="nmap-icon-btn">
            <ArrowLeft size={16} aria-hidden="true" />
            <span className="sr-only">Back to the summary</span>
          </button>
        ) : (
          <span className="nmap-meta">{branch?.label ?? "Article"}</span>
        )}
        <div className="flex items-center gap-1">
          <Link
            href={href}
            title="Open the full page"
            className="nmap-icon-btn"
          >
            <ArrowUpRight size={16} aria-hidden="true" />
            <span className="sr-only">Open the full page</span>
          </Link>
          {article && (
            <a
              href={article.editUrl}
              target="_blank"
              rel="noreferrer"
              title="Edit on GitHub"
              className="nmap-icon-btn"
            >
              <Pencil size={15} aria-hidden="true" />
              <span className="sr-only">Edit on GitHub</span>
            </a>
          )}
          <button type="button" onClick={onClose} className="nmap-icon-btn">
            <X size={17} aria-hidden="true" />
            <span className="sr-only">Close and return to the map</span>
          </button>
        </div>
      </header>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-10">
        <NodeImage node={node} className="h-40 rounded-lg" />
        <p className="nmap-meta mt-5">{branch?.label}</p>
        {/* Most articles open with an H1 of their own title; once the full
            text is showing, that heading takes over from this one. */}
        {!(expanded && article?.content.trimStart().startsWith("# ")) && (
          <h2 className="mt-2 text-2xl leading-tight font-semibold text-foreground">
            {node.label}
          </h2>
        )}

        {!expanded && (
          <>
            {node.description && (
              <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-2">
                {node.description}
              </p>
            )}
            <button
              type="button"
              onClick={onExpand}
              className="nmap-primary mt-7"
            >
              View full article
            </button>
          </>
        )}

        {expanded && (
          <>
            {error && (
              <p className="py-16 text-center text-muted">
                This article could not be loaded.{" "}
                <Link href={href} className="text-purple-deep underline">
                  Open the full page
                </Link>
                .
              </p>
            )}
            {!error && !article && <PanelSkeleton />}
            {article && (
              <article className="nmap-article mt-6">
                {article.notebook ? (
                  <NotebookRenderer notebook={article.notebook} dark />
                ) : (
                  <MarkdownRenderer content={article.content} dark />
                )}
                <footer className="mt-10 space-y-2 border-t border-line pt-6 text-sm text-muted">
                  {article.contributors.length > 0 && (
                    <p>
                      <span className="nmap-meta mr-3">Contributors</span>
                      {article.contributors.join(", ")}
                    </p>
                  )}
                  {article.updatedAt && (
                    <p>
                      <span className="nmap-meta mr-3">Last updated</span>
                      {article.updatedAt}
                    </p>
                  )}
                </footer>
              </article>
            )}

            {related.length > 0 && (
              <section className="mt-10">
                <p className="nmap-meta">More in {branch?.label}</p>
                <ul className="mt-3 space-y-2">
                  {related.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(r)}
                        className="nmap-related"
                      >
                        <span className="block font-medium text-foreground">
                          {r.label}
                        </span>
                        {r.snippet && (
                          <span className="mt-1 block text-sm text-muted">
                            {r.snippet}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function PanelSkeleton() {
  return (
    <div className="animate-pulse space-y-4 py-8" aria-hidden="true">
      <div className="h-3 w-1/3 rounded bg-surface-2" />
      <div className="h-3 w-full rounded bg-surface-2" />
      <div className="h-3 w-11/12 rounded bg-surface-2" />
      <div className="h-3 w-4/5 rounded bg-surface-2" />
      <div className="h-32 w-full rounded bg-surface" />
    </div>
  );
}
