# Architecture

AI Pedia is a Next.js 15 App Router site. Every page and every API response
is produced at build time from files in `content/`. There is no database, no
CMS, no login and no server-side state. The only thing rendered on demand is
the Open Graph image.

This document describes how the site is put together. README.md covers
running it and where to edit things. CONTRIBUTING.md covers writing articles.
docs/ROADMAP.md covers what comes next.

## Contents

1. Overview
2. Build pipeline
3. Content layer
4. Routes
5. Article rendering
6. The map
7. Search
8. SEO and metadata
9. Styling and themes
10. Security
11. CI, dependencies and releases
12. Invariants
13. Known limitations

## 1. Overview

```
content/*.md, *.ipynb
        |
        v
lib/content.ts  (reads files, parses frontmatter and notebooks)
        |
        +--> app/learn/...          static HTML pages per category and article
        +--> app/api/article/...    static JSON per article, for the map panel
        +--> lib/graph.ts           node positions for the map
        +--> getSearchIndex()       titles and descriptions for Cmd/Ctrl+K
        +--> app/sitemap.ts         sitemap.xml
```

Build output is static HTML, RSC payloads and JSON, served by `next start` or
any host that runs a Next.js build. The client adds interactivity on top of
this output: the map canvas, the reading panel, search, visualizations and the
copy action.

Main dependencies:

| Concern | Library |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript 5.9 |
| Styling | Tailwind CSS 4, plain CSS in `styles/` |
| Markdown | react-markdown, remark-gfm, remark-math, rehype-raw, rehype-sanitize, rehype-katex, rehype-slug |
| Notebooks | own parser in `lib/notebook.ts`, hast-util-sanitize for HTML outputs |
| Code highlighting | react-syntax-highlighter (Prism) |
| Visualizations | Recharts, three.js with @react-three/fiber and drei, Framer Motion |
| Frontmatter | gray-matter |
| Lint and format | Biome |

## 2. Build pipeline

`npm run build` runs `next build`, which:

1. Calls `generateStaticParams` in `app/learn/[category]/page.tsx`,
   `app/learn/[category]/[slug]/page.tsx` and
   `app/api/article/[category]/[slug]/route.ts`. Each one lists categories or
   articles through `lib/content.ts`.
2. Renders every page to HTML. `dynamicParams = false` on the dynamic routes,
   so a URL that was not generated returns 404 instead of rendering at request
   time.
3. Writes `/api/article/<category>/<slug>` as static JSON
   (`dynamic = "force-static"`).
4. Builds `sitemap.xml`, `robots.txt` and `manifest.webmanifest` from content
   and constants.

A YAML error in frontmatter throws in gray-matter and fails the build. Other
content problems do not fail the build (see section 13).

`next.config.ts` adds security headers on every path, long cache headers on
`/static` and `/_next/image`, and a permanent redirect from the old
database-era URLs (`/learn/<category>/<slug>_<24 hex id>`) to the current
ones.

## 3. Content layer

`lib/content.ts` is the only code that reads `content/`. Every function is
wrapped in React `cache`, so each file is read once per build worker.

Layout on disk:

```
content/
  <category>/              folder name is the URL slug
    _category.md           frontmatter only
    <slug>.md              Markdown article
    <slug>.ipynb           notebook article
```

Rules the loader applies:

- A folder or file name must match `^[a-z0-9]+(-[a-z0-9]+)*$`. Anything else
  is skipped without an error.
- Files starting with `_` and files that are not `.md` or `.ipynb` are skipped.
- A category folder without `_category.md` still appears, titled from its slug,
  with `order` 99.
- Categories sort by `order`, then title. Articles sort by title.
- If both `<slug>.md` and `<slug>.ipynb` exist, the Markdown file wins.

Types:

- `Category`: slug, title, description, image, order, mapPosition.
- `ArticleMeta`: slug, category, title, description, thumbnail, createdAt,
  updatedAt, contributors. Used for lists, the map and search.
- `Article`: `ArticleMeta` plus `content` (Markdown body), `headings` (for the
  table of contents), `source` (for Copy Markdown), `format` ("markdown" or
  "notebook") and, for notebooks, the parsed `notebook`.

Main functions: `getCategories`, `getCategory`, `getArticles(category?)`,
`getArticle(category, slug)`, `getSearchIndex`, `articleSourcePath` (for Edit
on GitHub links).

### Notebooks

`lib/notebook.ts` parses nbformat v4 JSON:

- Markdown cells are kept as Markdown. Raw cells are dropped.
- Code cells keep their source, execution count and outputs. The language
  comes from `language_info.name`, then `kernelspec.language`, then defaults
  to python.
- For each output, the parser picks the richest type in this order: PNG, JPEG,
  GIF, SVG, HTML, plain text. `stream` becomes text. `error` becomes its
  traceback. ANSI color codes are stripped.
- HTML outputs are sanitized at build time with GitHub's schema, plus `class`
  and `style` and `data:` image sources. `script`, `style`, `head` and `title`
  are dropped with their contents.
- Images are embedded as `data:` URIs, so they are part of the page payload.
- The title is the first `# heading` in a Markdown cell, and that heading is
  removed from the body so the page does not show it twice. Other frontmatter
  fields come from `metadata["ai-pedia"]`.
- `notebookToMarkdown` flattens the cells to Markdown with fenced code. The
  table of contents and Copy Markdown use this flattened version.

A notebook that is not valid JSON, or has no `cells` array, makes
`parseNotebook` return null, and the article is silently left out.

## 4. Routes

| Route | Source | Kind |
|---|---|---|
| `/` | `app/page.tsx` | Static. The map |
| `/learn` | `app/learn/page.tsx` | Static. The same map |
| `/learn/<category>` | `app/learn/[category]/page.tsx`, `CategoryPageClient.tsx` | Static per category. Article list with map vignette header |
| `/learn/<category>/<slug>` | `app/learn/[category]/[slug]/page.tsx`, `ArticleView.tsx` | Static per article |
| `/api/article/<category>/<slug>` | `app/api/article/[category]/[slug]/route.ts` | Static JSON (`ArticlePayload` in `lib/article-payload.ts`) |
| `/opengraph-image` | `app/opengraph-image.tsx` | Edge function, one image for the whole site |
| `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest` | `app/sitemap.ts`, `robots.ts`, `manifest.ts` | Static |

`app/layout.tsx` wraps every page with fonts, site metadata, JSON-LD for the
organization and website, and the navbar. The navbar receives the search index
as a prop.

## 5. Article rendering

The article page and the map's reading panel render with the same
components, so an article looks the same in both places.

### Markdown

`components/MarkdownRenderer.tsx` runs react-markdown with:

1. remark-gfm (tables, strikethrough, task lists, autolinks) and remark-math.
2. rehype-raw, which parses raw HTML in the Markdown into real elements.
3. rehype-sanitize with `sanitizeSchema`. This is GitHub's schema plus
   `iframe`, `div` ids and `data-placeholder`, and `math-inline` and
   `math-display` classes on `code`. `clobberPrefix` is empty, so ids are kept
   as written.
4. rehype-katex, which turns math into KaTeX HTML. It runs after sanitizing, so
   KaTeX output is not filtered.
5. rehype-slug, which adds heading ids for the table of contents.

Custom element renderers then:

- add classes to headings, paragraphs and emphasis for `styles/markdown.css`;
- open external links in a new tab with `noopener noreferrer`;
- highlight fenced code with Prism (light theme on article pages, dark in the
  map panel);
- wrap tables in a horizontal scroller;
- replace `<iframe>` with a responsive frame when `resolveEmbedSrc` in
  `lib/embeds.ts` accepts the URL, and with a plain link otherwise;
- replace `<div id="VZ-...">` with a lazy-loaded visualization.

### Notebooks

`components/NotebookRenderer.tsx` walks the parsed cells. Markdown cells go
through `MarkdownRenderer`. Code cells show the execution count and
highlighted source. Outputs render as an image, a `<pre>` for text and errors,
or pre-sanitized HTML through `dangerouslySetInnerHTML`.

### Embeds

`lib/embeds.ts` holds `ALLOWED_HOSTS` and rewrites YouTube (to
youtube-nocookie) and Vimeo share URLs into their embed form. Only `https:`
URLs on the list render as frames. Frames get `loading="lazy"`, a strict
referrer policy, and a fixed `allow` list. Their size comes from `data-ratio`,
from `width` and `height`, or defaults to 16:9.

### Visualizations

- `components/visualizations/visualization-registry.tsx` maps `VZ-` ids to
  React components. The only registered components are the linear regression
  set in `categories/linear-regression/`.
- `LazyVisualization.tsx` loads the registry with a dynamic import on the
  client. The visualization code (Recharts, three.js) stays out of the article
  bundle until a placeholder mounts.
- An unknown id renders `VisualizationError` with type "not-found". The page
  does not fail.
- `components/visualizations/shared/` holds common controls (sliders, panels),
  animation variants and types.

### Page chrome

`ArticleView.tsx` lays out the header (title, description, contributors,
updated date), the body, and `TableOfContents.tsx`. The table of contents
tracks `##` and `###` headings with an intersection observer.
`components/ui/page-actions.tsx` adds Copy Markdown (copies `source`) and Edit
(links to `github.com/.../edit/main/<path>`) to the navbar on article pages.
`components/map-vignette.tsx` crops `public/art/map.svg` to the category's
region (`lib/map-regions.ts`, or `mapPosition` from `_category.md`) for
category and article headers.

## 6. The map

The home page and `/learn` render `GraphStage`, which renders `NeuralMap` on a
full-screen canvas. The map has four parts.

### Layout (build time): `lib/graph.ts`

`getGraph()` computes every named node's position once, at build time:

- The root node sits at the origin. Categories sit evenly on a ring of radius
  1000 around it.
- Each category's articles are scattered through a lobe to either side of the
  category. They are then relaxed apart for 140 passes, keeping at least 215
  units from each other and 275 from their category's label, and at most 1.5
  cluster radii away.
- Randomness comes from mulberry32 seeded with an FNV-1a hash of the node id.
  The map is identical on every build and every load, as long as the content
  is unchanged. Adding an article moves only its own category's articles.
- Each node carries its label, a sublabel ("3 topics"), description, a
  130-character snippet for hover previews, an image, its route and a palette
  index.
- `GraphData` is `{ nodes, clusters, ring }`. Clusters hold each category's
  center, radius and bounding box, which the camera uses for framing.

`lib/graph-types.ts` holds the types and has no Node imports, so the client
can import them without pulling `node:fs` into the bundle.

### Network (client): `components/graph/network.ts`

The canvas draws the named nodes plus about 300 unnamed background neurons
(times the density tweak). Links are not stored anywhere. Each frame, any two
neurons within 250 units are linked (1.5 times that if one of them is named),
so links form and break as neurons drift. The adjacency list that signals
travel along is rebuilt every 700 ms. Around 34 ambient signals hop between
neurons, and clicking a node fires a burst of 10. Glows are drawn from
pre-rendered sprites instead of `shadowBlur`, which is much faster.

### Camera: `components/graph/camera.ts`

The camera is `{ x, y, k, ox }`: the world point in view, the zoom, and the
screen x the view centers on. `ox` shifts when the reading panel takes part of
the width. Input moves a target camera, and each frame the real camera eases
toward it at a frame-rate-independent rate. Zoom eases in log space. The
overview fits the ring. Focusing a category frames its cluster's bounding box
in the free width.

### Component: `components/graph/neural-map.tsx`

This component owns the animation loop (`requestAnimationFrame`), pointer and
wheel input, hit testing (a padded box around each label), hover preview
cards, and focus state. Details:

- Labels fade in with zoom and with distance from the center of the view. The
  category nearest the center lights up while panning.
- `prefers-reduced-motion` stops drift and signals and makes camera moves
  instant.
- Tweaks for density, glow and drift (`map-tweaks.tsx`) are saved in
  localStorage under `ai-pedia:map-tweaks`.
- `map-panel.tsx` is loaded with `next/dynamic` and `ssr: false` on the first
  click, so the Markdown, KaTeX and Prism code only loads when someone opens
  an article. The panel starts as a summary (image, title, description) and
  widens to the full article, fetched from `/api/article/...` and cached in
  memory per session. The rest of the category is listed below the article.
- The map pages set `data-theme="space"` on `<main>`. That swaps the CSS color
  tokens to the dark theme, so the navbar and search palette above the map go
  dark without code changes. Article pages keep the light theme.

The map is decorative navigation. Every article is also reachable through
plain links on the category pages, and through search and the sitemap. Search
engines index the article pages, not the canvas.

## 7. Search

`getSearchIndex()` builds entries for each category and article (title,
description, path, type, category title) at build time. `app/layout.tsx`
passes the entries to the navbar, so they are inlined into every page's
payload. `components/ui/command-palette.tsx` opens on Cmd/Ctrl+K and filters
by case-insensitive substring match on title and description, together with
the fixed nav items from `lib/constants.ts`. Article bodies are not indexed.

## 8. SEO and metadata

- Site-wide metadata is set in `app/layout.tsx` (title template
  "%s · AI Pedia", Open Graph, Twitter, robots, optional search-console
  verification from `NEXT_PUBLIC_GOOGLE_VERIFICATION` and
  `NEXT_PUBLIC_YANDEX_VERIFICATION`).
- The canonical origin is `SITE_URL` in `lib/site.ts`, from
  `NEXT_PUBLIC_SITE_URL`, defaulting to `https://ai-pedia.ais-asu.com`.
- Article pages set their own title, description, canonical URL, Open Graph
  type "article" with the thumbnail, and JSON-LD (`LearningResource`) for the article and its
  breadcrumbs.
- `sitemap.ts` uses each article's `updatedAt` as `lastModified` and falls
  back to the build time.
- `/` and `/learn` render the same map. `/` is canonical.

## 9. Styling and themes

- `app/globals.css` defines the color, font and spacing tokens on `:root` (the
  light "paper" theme) and overrides them under `[data-theme="space"]`.
  Tailwind 4 utilities reference the tokens.
- `styles/markdown.css` styles article bodies. Some of its `!important` rules
  override inline styles set by the syntax highlighter and KaTeX. Biome warns
  about them, and the warnings are intentional.
- `styles/graph.css` styles the map overlays: labels, preview cards, the
  panel, the tweaks drawer.
- Fonts load through `next/font` in `app/layout.tsx`.
- `lib/constants.ts` holds a copy of the palette for code that needs colors in
  JavaScript. It must stay in step with `globals.css`.

## 10. Security

The threat model: anyone can open a pull request with content, and a
maintainer merges it after review. There are no users, sessions or secrets on
the site.

- Article HTML is sanitized (section 5). Scripts, event handlers,
  `javascript:` URLs and styles are removed.
- Iframes are limited to `ALLOWED_HOSTS` and `https:`.
- Notebook HTML outputs are sanitized at build time.
- Visualizations are code in the repo, not content, so they go through code
  review like any other component.
- Response headers: HSTS, `X-Frame-Options: SAMEORIGIN`, `nosniff`,
  `Referrer-Policy`, and a `Permissions-Policy` that disables camera,
  microphone and geolocation. There is no Content-Security-Policy yet.
- `npm audit` runs weekly in CI (section 11).

## 11. CI, dependencies and releases

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | push to main, every PR | Biome lint, `tsc --noEmit`, `next build` on Node 22 |
| `security-audit.yml` | Mondays 14:00 UTC, manual | `npm audit --audit-level=high` |
| `release.yml` | push to main, manual | Creates tag `v<package.json version>` and a GitHub release from the matching CHANGELOG.md section, if it does not exist yet |

Dependabot opens grouped npm updates (production minor and patch, dev
dependencies) and GitHub Actions updates every Monday. `package.json`
`overrides` pins Next.js's bundled PostCSS to a patched version.

There are no unit or end-to-end tests. CI only checks that the site lints,
typechecks and builds.

Hosting is configured outside the repository. Nothing in the repo deploys.

## 12. Invariants

- Only `lib/content.ts` (and `lib/notebook.ts`, which it calls) read
  `content/`. Pages, the graph and search all go through it.
- Nothing reads files or computes content at request time. New features that
  need content must work from build-time data.
- Client code must not import `lib/content.ts`, `lib/graph.ts` or
  `lib/notebook.ts`, which use `node:fs` and `Buffer`. Share types through
  `lib/graph-types.ts` and `lib/article-payload.ts`.
- Every article renderer path (article page, map panel, notebook Markdown
  cells) goes through `MarkdownRenderer`, so sanitizing applies everywhere.
- Map layout is deterministic. Do not add unseeded randomness to
  `lib/graph.ts`.
- `VZ-` ids in articles must exist in the registry.
- An article URL is `/learn/<category folder>/<file name without extension>`.
  Renaming a file or folder changes the URL and needs a redirect in
  `next.config.ts`.

## 13. Known limitations

- Content errors other than YAML syntax do not fail the build: an invalid
  slug, a broken notebook, an unknown `VZ-` id, a missing image or a broken
  internal link is skipped or shows up only on the page.
- Search matches titles and descriptions only.
- The map draws on a canvas. Its labels are not in the accessibility tree.
  Keyboard and screen-reader users navigate through the category pages and
  search instead.
- Notebook images are inlined as base64. Large notebooks make large pages.
- Notebooks are static: outputs are whatever was saved, and interactive
  widgets (ipywidgets, Plotly, Bokeh) don't run, because their scripts are
  stripped.
- One Open Graph image is used for the whole site.
- The WebSite JSON-LD advertises `/learn?search=...` as a search URL, but no
  page reads that parameter.
- There are no tests beyond lint, typecheck and build.
