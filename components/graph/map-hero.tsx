"use client";

import { ArrowRight, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { siteConfig } from "@/lib/constants";

export interface MapStats {
  categories: number;
  articles: number;
  sections: number;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The title card that stands over the root of the map. It is pinned to the
 * root in screen space by the camera (which writes its transform), sits in a
 * soft vignette that clears the mesh behind the type, and fades away as you
 * zoom past it into the branches.
 *
 * The card itself lets pointer events through, so a drag that starts on the
 * title still pans the map; only the buttons take clicks.
 */
export function MapHero({
  ref,
  stats,
  onExplore,
  onSearch,
}: {
  ref: React.Ref<HTMLDivElement>;
  stats: MapStats;
  onExplore: () => void;
  onSearch: () => void;
}) {
  const [isMac, setIsMac] = useState(true);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  return (
    <div ref={ref} className="ngraph-hero">
      <div className="ngraph-hero-vignette" aria-hidden="true" />
      <div className="ngraph-hero-glow" aria-hidden="true" />
      <div className="relative flex w-[min(88vw,620px)] flex-col items-center text-center">
        <p className="eyebrow">The AI Society · Arizona State University</p>
        <h1 className="mt-4 font-display text-6xl leading-none text-foreground sm:text-8xl">
          AI Pedia
        </h1>
        <p className="mt-5 max-w-md text-lg leading-snug text-ink-2">
          {siteConfig.description}, drawn as a map you can fly through.
        </p>
        <p className="mt-5 text-[0.7rem] tracking-[0.18em] text-muted uppercase">
          {plural(stats.categories, "branch", "branches")} ·{" "}
          {plural(stats.articles, "article", "articles")} ·{" "}
          {plural(stats.sections, "section", "sections")}
        </p>
        <div className="pointer-events-auto mt-7 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onExplore}
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2 text-sm text-background transition-opacity hover:opacity-85"
          >
            Start exploring
            <ArrowRight size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onSearch}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-background/80 py-2 pr-2.5 pl-4 text-sm text-ink-2 transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <Search size={14} aria-hidden="true" />
            Search
            <kbd className="rounded border border-line bg-surface px-1.5 font-mono text-[0.68rem] text-muted">
              {isMac ? "⌘" : "Ctrl"} K
            </kbd>
          </button>
        </div>
        <p className="mt-6 text-xs text-muted">
          Scroll to zoom · drag to pan · click any node to read
        </p>
      </div>
    </div>
  );
}
