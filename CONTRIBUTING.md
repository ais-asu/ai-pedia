# Contributing

AI Pedia is a collection of Markdown articles. Anyone can propose a change
through a pull request, and a maintainer from The AI Society reviews and merges
it. Merged changes go live with the next deploy.

Contents: [fix an article](#fix-an-article) ·
[write a new article](#write-a-new-article) ·
[frontmatter reference](#frontmatter-reference) ·
[what you can use in an article](#what-you-can-use-in-an-article) ·
[notebooks](#jupyter-notebooks) · [categories](#categories) ·
[visualizations](#interactive-visualizations) · [embeds](#embeds) ·
[writing guidelines](#writing-guidelines) · [code changes](#code-changes)

## Fix an article

1. Open the article on the site and click **Edit** in the top bar. This opens
   the source file on GitHub.
2. Make your change in the GitHub editor and choose **Propose changes**. GitHub
   creates a fork and a pull request for you.
3. Say what you changed in the pull request.

Typos, broken links and wrong formulas are welcome and usually merged quickly.

## Write a new article

1. Pick the category folder under `content/`: `supervised`, `unsupervised`,
   `reinforcement` or `statistics`. If none fits, see [Categories](#categories).
2. Create `content/<category>/<slug>.md`. The slug is lowercase words joined by
   hyphens, and it becomes the URL: `content/supervised/logistic-regression.md`
   is served at `/learn/supervised/logistic-regression`.
3. Start the file with frontmatter, then write the article:

   ```md
   ---
   title: "Logistic Regression"
   description: "One or two sentences. Shown on the category page, in search and on the map."
   createdAt: "2026-10-01"
   contributors:
     - "Your Name"
   ---

   # Logistic Regression

   Your article in Markdown.
   ```

4. Preview it locally (see [Preview locally](#preview-locally)). If you can't,
   say so in the pull request and a maintainer will check it.
5. Open a pull request. The title can simply be "Add article: Logistic
   Regression".

`content/supervised/linear-regression.md` is a complete example that uses math,
code, tables and visualizations.

### Preview locally

```bash
npm install
npm run dev       # open http://localhost:3000/learn/<category>/<slug>
npm run build     # optional, fails if any frontmatter is malformed
```

## Frontmatter reference

Articles (`<slug>.md`):

| Field | Required | Example | Used for |
|---|---|---|---|
| `title` | yes | `"Linear Regression"` | Page title, map label, search. Defaults to the slug in title case |
| `description` | yes | `"Fitting a line to data."` | Category page, search, map preview, SEO |
| `thumbnail` | no | `"/images/linear-regression.png"` | Map node image and link previews. The file goes in `public/images/` |
| `createdAt` | no | `"2026-10-01"` | Shown on the page. Use YYYY-MM-DD |
| `updatedAt` | no | `"2026-11-15"` | Shown on the page. Use YYYY-MM-DD |
| `contributors` | no | `["Jane Doe"]` | Author credits |

Categories (`_category.md`):

| Field | Required | Example | Used for |
|---|---|---|---|
| `title` | yes | `"Unsupervised"` | Category name everywhere |
| `description` | yes | `"Clustering and dimensionality reduction."` | Category page, map |
| `order` | no | `2` | Sort order, lowest first. Defaults to 99 |
| `image` | no | `"/images/statistics-category.webp"` | Map node image |
| `mapPosition` | no | `"40% 60%"` | Which part of the hand-drawn map the category header shows |

Quote string values. A YAML error in frontmatter fails the build.

## What you can use in an article

- **Headings:** Use `#` for the article title and `##` and `###` for sections.
  `##` and `###` build the "On this page" navigation.
- **Text:** Standard Markdown: bold, italics, links, lists, block quotes.
- **Tables:** GitHub-style tables.
- **Math:** LaTeX with `$x^2$` inline, and `$$ ... $$` on their own lines for
  display equations.
- **Code:** Fenced blocks with a language, such as ` ```python `, are
  syntax-highlighted.
- **Images:** Put the file in `public/images/` and write
  `![Description of the image](/images/file.png)`. Always write the
  description.
- **Line breaks inside a table cell:** `<br>`.
- **Links to other articles:** `[Gradient Descent](/learn/supervised/gradient-descent)`.

Raw HTML is sanitized with GitHub's rules. Formatting tags such as `<br>`,
`<sub>`, `<sup>` and `<details>` work. Scripts, styles, event handlers (`onclick`
and the like) and `javascript:` links are removed. The only other elements
allowed are the `VZ-` visualization placeholders and `<iframe>` embeds described
below.

## Jupyter notebooks

A notebook can be an article on its own. Save it as
`content/<category>/<slug>.ipynb` and it gets a page at
`/learn/<category>/<slug>`, rendered the way GitHub renders one: markdown cells
as prose, code cells highlighted, and saved outputs below each cell (text,
images, dataframe tables, tracebacks).

- Outputs are read from the file as committed, so run the notebook and save it
  before committing. Clear any output you don't want published.
- The title comes from the notebook's first `# heading`. Set the other fields
  under an `ai-pedia` key in the notebook metadata (Edit > Notebook Metadata in
  Jupyter, or edit the JSON):

  ```json
  "metadata": {
    "ai-pedia": {
      "description": "One sentence shown under the title and in search.",
      "updatedAt": "2026-09-03",
      "contributors": ["your-github-username"]
    }
  }
  ```

- HTML outputs are sanitized. Scripts and styles are removed, so a widget that
  needs JavaScript won't work. Export it as an image or use an embed.
- Keep notebooks under a few megabytes. Large embedded images make large files.

## Categories

A category is a folder under `content/` with a `_category.md` inside:

```md
---
title: "Unsupervised"
description: "Clustering, dimensionality reduction, and density estimation."
order: 2
---
```

The folder name is the URL slug (`/learn/unsupervised`). A new category shows
up on the map and in navigation automatically. To give it its own spot on the
hand-drawn map header, set `mapPosition`, or add it to `lib/map-regions.ts`
with a label. Ask a maintainer before adding a category, so the list stays
small.

## Interactive visualizations

Articles can embed React visualizations. Put the placeholder on its own line,
with blank lines around it:

```html
<div id="VZ-linear-equation" data-placeholder="Interactive Linear Equation"></div>
```

`data-placeholder` is the text shown while it loads. Available ids:

| id | Shows |
|---|---|
| `VZ-linear-equation` | Slope and intercept sliders over noisy data |
| `VZ-assumptions-plots` | Linear regression diagnostic plots |
| `VZ-regression-comparison` | From-scratch vs scikit-learn: error, R² and training time |
| `VZ-model-evaluation` | Regression metrics dashboard |
| `VZ-interactive-demo` | Polynomial features and regularization |

An unknown id renders a "visualization not found" box instead of breaking the
page.

To build a new one (this needs React and TypeScript):

1. Create the component in a folder under
   `components/visualizations/categories/`, for example
   `categories/logistic-regression/decision-boundary.tsx`.
   Shared helpers are in `components/visualizations/shared/`.
2. Export it from that folder's `index.ts`, and export the folder from
   `categories/index.ts`.
3. Import it in `components/visualizations/visualization-registry.tsx` and add
   it to `VISUALIZATION_COMPONENTS` under an id that starts with `VZ-`.
4. Use that id in the article, and add a row to the table above.

## Embeds

Embed external pages with a plain `<iframe>` on its own line, with blank lines
around it:

```html
<iframe src="https://www.youtube.com/watch?v=VIDEO_ID" title="What the video shows"></iframe>
```

- Paste the normal share URL. YouTube and Vimeo links are rewritten to their
  embed form automatically.
- The frame is responsive and defaults to 16:9. Override the shape with
  `data-ratio="4/3"`, or set a fixed height with `height="480"`.
- `data-caption="..."` adds a caption below the frame.
- Always set `title`. Screen readers announce it.
- Only the hosts in `lib/embeds.ts` render: YouTube, Vimeo, CodeSandbox,
  CodePen, StackBlitz, Observable, Hugging Face, Colab, Google Docs and Drive,
  Desmos and GeoGebra. Any other host is replaced with a link. To add a
  provider, add its hostname to that file in the same pull request.

## Writing guidelines

- Write for a student who has taken one programming class. Explain the idea in
  words before the formula, and define every symbol you use.
- Keep one topic per article. Link to other articles instead of repeating them.
- Use plain language. No hype, and no emoji in prose.
- Cite sources for claims that aren't common knowledge.
- Code should run as written. Say which libraries it needs.

## Code changes

For anything outside `content/`, read the "Where to change what" table in
[README.md](README.md). Run `npm run lint`, `npm run typecheck` and
`npm run build` before opening a pull request. CI runs the same checks. Attach a
screenshot for visual changes.
