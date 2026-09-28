# AI Pedia

An interactive encyclopedia of artificial intelligence, written and maintained by
[The AI Society](https://www.ais-asu.com/) at Arizona State University.
Live at https://ai-pedia.ais-asu.com.

Articles are Markdown (or Jupyter notebook) files in this repository. There is no
database, no CMS and no login. To add or fix an article, you open a pull request.

- Writing or editing an article: read [CONTRIBUTING.md](CONTRIBUTING.md).
- Changing the site itself, or taking over maintenance: read on.

## Run it locally

Requires Node 22 (the version CI uses).

```bash
git clone https://github.com/theaisocietyasu/ai-pedia.git
cd ai-pedia
npm install
npm run dev            # http://localhost:3000
```

No environment variables are needed locally. `.env.example` lists the optional ones.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build. Prerenders every page and fails on a broken article |
| `npm start` | Serve the production build |
| `npm run lint` | Biome lint and format check |
| `npm run format` | Biome format, writes changes |
| `npm run typecheck` | `tsc --noEmit` |

Before opening a pull request, run `npm run lint`, `npm run typecheck` and
`npm run build`. CI runs the same three.

## How it works

Everything is generated at build time. `lib/content.ts` reads `content/`, and
Next.js prerenders one static page per category and per article. Nothing reads
files or talks to a server at request time.

- Home and `/learn`: a canvas "neural map" of the library (`components/graph/`).
  Categories sit on a ring, and their articles cluster around them. Clicking an
  article opens a reading panel that loads `/api/article/<category>/<slug>`, a
  static JSON file generated at build time.
- `/learn/<category>`: a list of the category's articles.
- `/learn/<category>/<slug>`: the article, rendered by
  `components/MarkdownRenderer.tsx` (or `NotebookRenderer.tsx` for `.ipynb`).
- Search (Cmd/Ctrl+K): `components/ui/command-palette.tsx`, over an index built
  from article titles and descriptions.

Article HTML is sanitized before rendering, because articles come from outside
pull requests. Only the tags, iframe hosts and `VZ-` placeholders described in
CONTRIBUTING.md survive.

Stack: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4,
react-markdown with remark-gfm, remark-math, rehype-katex and rehype-sanitize,
Recharts and three.js for visualizations, and Biome for lint and format.

## Where to change what

| To change | Edit |
|---|---|
| An article or a category | `content/<category>/`, see CONTRIBUTING.md |
| Article images | `public/images/` |
| Site name, contact email, repo link | `lib/constants.ts` (`siteConfig`) |
| Canonical URL, SEO description | `lib/site.ts`, `app/layout.tsx` |
| Navbar and footer links | `lib/constants.ts`, `components/ui/navbar.tsx`, `components/ui/footer.tsx` |
| Colors and fonts | `app/globals.css` (tokens on `:root`), fonts in `app/layout.tsx` |
| Article typography | `styles/markdown.css` |
| The map (layout, look, camera) | `components/graph/`, `lib/graph.ts`, `styles/graph.css` |
| Map vignette position and label for a category | `lib/map-regions.ts`, or `mapPosition` in `_category.md` |
| Allowed iframe hosts | `lib/embeds.ts` (`ALLOWED_HOSTS`) |
| Which raw HTML articles may use | `sanitizeSchema` in `components/MarkdownRenderer.tsx` |
| Interactive visualizations | `components/visualizations/`, registered in `visualization-registry.tsx` |
| Redirects and security headers | `next.config.ts` |

## Project structure

```
app/
  page.tsx                  Home (the map)
  learn/                    /learn, category pages, article pages
  api/article/              Static JSON for the map's reading panel
  sitemap.ts, robots.ts, manifest.ts, opengraph-image.tsx
components/
  graph/                    The neural map
  ui/                       Navbar, footer, search palette, page actions
  visualizations/           Interactive demos and their registry
  MarkdownRenderer.tsx      Article Markdown to HTML, including sanitizing
  NotebookRenderer.tsx      .ipynb articles
  TableOfContents.tsx       "On this page" rail
content/                    The encyclopedia (one folder per category)
lib/
  content.ts                Reads content/ at build time
  notebook.ts               Parses and sanitizes notebooks
  embeds.ts                 iframe allowlist
  graph.ts                  Builds the map's nodes from content
public/                     Static files; article images in public/images/
styles/                     markdown.css (articles), graph.css (map)
docs/                       Source artwork for the map
```

## Maintaining

**Hosting.** The site is a standard Next.js app: `npm run build` then
`npm start`, on Node 22, with no secrets and no database. It runs on Vercel or
any Node host. Hosting and the `ai-pedia.ais-asu.com` domain are configured
outside this repository. Set `NEXT_PUBLIC_SITE_URL` on the host if the domain
ever changes.

**Reviewing pull requests.** For content, check out the branch and look at the
rendered page with `npm run dev`, not just the diff. For code, CI must be green.

**Dependencies.** Dependabot opens grouped update PRs every Monday. Minor and
patch updates can be merged once CI is green. For major updates (Next.js,
React, lucide-react), run the site locally and click through the map and an article first.

**Security.** `.github/workflows/security-audit.yml` runs `npm audit` every
Monday and fails on high or critical advisories. When it fails, run
`npm audit fix` locally, then build and open a PR. If the fix needs a
dependency that another package pins, add it under `overrides` in
`package.json`. The current override makes Next.js use a patched PostCSS.

**Releases.** Releases are tagged on GitHub as `vMAJOR.MINOR.PATCH` and noted in
[CHANGELOG.md](CHANGELOG.md). Deploys don't depend on releases; a tag just marks
a known-good state. To cut one, bump `version` in `package.json` and add a
matching `## X.Y.Z` section to CHANGELOG.md in the same pull request. When it
merges, `.github/workflows/release.yml` creates the tag and the GitHub release,
using that section as the notes.

## License

[MIT](LICENSE). Articles under `content/` are contributed by their listed
authors and published under the same license.
