import wasmMeta from '../dist/meta.json' with { type: 'json' };
import { renderToHtml } from '../dist/workerd.mjs';
import pkg from '../package.json' with { type: 'json' };

const examples = {
  overview: `# @pierre/markdowns

A GitHub Flavored Markdown renderer written **by hand** in WebAssembly Text.
Everything on this page is rendered by ~65 KB of Wasm, in *one* pass over
linear memory.

## What it supports

- [x] CommonMark 0.31.2, all 642 examples
- [x] Tables, task lists, strikethrough, autolinks
- [x] Footnotes[^why] and YAML frontmatter
- [ ] Anything that needs an AST

[^why]: Not in the GFM specification, but GitHub renders them, so we do too.

## Inline

Emphasis is *italic*, **bold**, ***both***, and ~~struck through~~.
Code spans keep \`their <em>markup</em>\` literal, and links can be
[inline](https://github.com/wat-labs/md "the repository"), [collapsed][] or
bare: https://github.com/wat-labs/md.

[collapsed]: https://github.com/wat-labs/md

## Blocks

> Block quotes nest, and a lazy continuation
line still belongs to the paragraph above.
>
> 1. Ordered lists
> 2. keep their numbers
>    - and their nesting

\`\`\`js
import { renderToHtml, renderToAnsi } from "@pierre/markdowns";

const html = renderToHtml("# Hello, **world**!");
const ansi = renderToAnsi("# Hello, **world**!");
\`\`\`

| Backend | Output | Throughput |
| ------- | :----- | ---------: |
| HTML    | \`<h1>\` and friends | 254 MB/s |
| ANSI    | SGR escapes for a terminal | 231 MB/s |

---

Entities work too: &copy; &amp; &#x1F49A; &nbsp;— and so do hard breaks,\\
like that one.
`,

  chamele: `## What is Chamele?

Chamele is a fast syntax highlighter written by hand/agentic in WebAssembly Text (WAT).

* **Lightweight:** 28 KB gzipped Wasm for 29 languages
* **Fast:** 91–668× faster than Shiki in benchmark
* **Self-contained:** Built-in lexers require no external grammar definitions
* **Theme support:** Compatible with Zed theme definitions

👉 [Try the Chamele playground](https://chamele-playground.wat-labs.com/)

## Why is it small and fast?

* **Single-pass lexing:** Each lexer emits HTML or tokens while scanning, without building an AST, or using regexes.
* **Zero-copy output:** Consumers read results directly from WebAssembly memory.
* **SIMD scanning:** Hot paths process 16 bytes at a time.
* **Handwritten WAT:** Every hot-path instruction is intentional, with no C/Rust-to-Wasm compiler overhead.


| Input | Chamele, bytes | Chamele | tree-sitter-highlight | Lezer | Shiki |
| --- | ---: | ---: | ---: | ---: | ---: |
| \`small.jsonc.txt\` (30 KB) | **2,044 MB/s (158×)** | 1,787 MB/s (138×) | 48.5 MB/s (3.77×) | 39.3 MB/s (3.06×) | 12.8 MB/s (baseline) |
| \`tiny.jsonc.txt\` (1 KB) | **1,772 MB/s (138×)** | 1,162 MB/s (90.5×) | 50.4 MB/s (3.87×) | 16.3 MB/s (1.26×) | 13.1 MB/s (baseline) |
| \`large.jsonc.txt\` (292 KB) | **692 MB/s (140×)** | 588 MB/s (119×) | 22.8 MB/s (4.58×) | 14.3 MB/s (2.93×) | 4.97 MB/s (baseline) |
| \`small.html.txt\` (4 KB) | **387 MB/s (178×)** | 247 MB/s (113×) | 17.4 MB/s (8.08×) | 13.1 MB/s (6.08×) | 2.15 MB/s (baseline) |
| \`large.html.txt\` (409 KB) | **368 MB/s (1,168×)** | 210 MB/s (668×) | 32.1 MB/s (101×) | 30.9 MB/s (98.2×) | 0.32 MB/s (baseline) |
| \`tiny.css.txt\` (2 KB) | **320 MB/s (614×)** | 274 MB/s (519×) | 12.0 MB/s (22.6×) | 10.8 MB/s (20.4×) | 0.52 MB/s (baseline) |
| \`tiny.html.txt\` (2 KB) | **317 MB/s (248×)** | 284 MB/s (223×) | 20.1 MB/s (16.0×) | 18.6 MB/s (14.9×) | 1.25 MB/s (baseline) |
| \`large.ts.txt\` (466 KB) | **293 MB/s (254×)** | 263 MB/s (228×) | 9.24 MB/s (8.08×) | 7.43 MB/s (6.46×) | 1.15 MB/s (baseline) |
| \`tiny.ts.txt\` (1 KB) | **285 MB/s (199×)** | 261 MB/s (183×) | 8.58 MB/s (5.97×) | 7.09 MB/s (4.96×) | 1.44 MB/s (baseline) |
| \`large.css.txt\` (304 KB) | **270 MB/s (332×)** | 169 MB/s (207×) | 8.74 MB/s (10.8×) | 5.27 MB/s (6.46×) | 0.81 MB/s (baseline) |
| \`small.ts.txt\` (31 KB) | **253 MB/s (353×)** | 211 MB/s (294×) | 7.40 MB/s (10.4×) | 5.27 MB/s (7.36×) | 0.72 MB/s (baseline) |
| \`small.css.txt\` (24 KB) | **244 MB/s (289×)** | 190 MB/s (228×) | 8.42 MB/s (10.0×) | 4.53 MB/s (5.52×) | 0.82 MB/s (baseline) |

> Measured on 2026-08-24 with Node.js 24.19.0 on a 14-core Apple M4 Pro with 48 GB
> RAM (macOS arm64). Higher is better. Parentheses show speedup over Shiki. Rows are
> sorted by Chamele byte-API throughput.

## Proposed Integration in Diffs

Chamele can be integrated as an optional highlighter factory to \`BaseCodeOptions\`(Keep Shiki as the default without any changes):

\`\`\`js
import { FileDiff } from "@pierre/diffs";
import { createHighlighter } from "@pierre/diffs/chamele";
// Or:
// import { createHighlighter } from "@pierre/diffs/shiki";

const file = new FileDiff({ createHighlighter });
\`\`\`

### \`createHighlighter\` type

\`\`\`ts
export interface HighlighterOptions {
  themes?: readonly string[];
  langs?: readonly string[];
}

export type CreateHighlighter = (
  request: HighlighterOptions
) => DiffsHighlighter;

// unified highlighter interface for both Shiki and Chamele
export interface DiffsHighlighter {
  codeToTokens(code: string, options: CodeToTokensOptions): readonly TokenStyle[][];
  dispose?(): void;
}

// unified token model for both Shiki and Chamele
export interface TokenStyle {
  offset: number; // data-char
  foreground?: string;
  background?: string;
  fontStyle?: "italic" | "normal";
  fontWeight?: number;
}
\`\`\`

## Surface integration feasibility

| Surface | Feasibility | Required work |
| --- | --- | --- |
| \`File\`, \`FileDiff\` | High | Common line/token model, Chamele token output, shared decoration builder |
| Virtualized views and \`CodeView\` | High | Same output model; keep existing render caches and ranges |
| SSR and hydration | High | Use the selected factory during preload and ensure client/server provider parity |
| Worker pool | Medium | Add provider-specific worker entry points; functions cannot cross \`postMessage\` |
| Editor | Medium | Abstract \`EditorTokenizer\`; Shiki stays incremental, Chamele may initially rescan the document |
| \`FileStream\` | Low for parity | It relies on Shiki grammar state and token recalls; keep it Shiki-only initially |
| Custom languages | Shiki only at runtime | Chamele languages are compiled into Wasm; new lexers require a Chamele release |
| Custom themes | Medium | Shiki uses TextMate themes; Chamele requires Zed capture themes or an explicit conversion |

An unsupported optional capability should fail with a specific error. Silently switching
from Chamele to Shiki during editing or streaming can change colors and bundle behavior.

## Themes and languages

Chamele includes the default \`pierre-dark\` and \`pierre-light\` themes, providing a direct migration path for the default Diffs configuration. General theme compatibility, however, is not automatic:

* Shiki themes use TextMate scopes and include editor and Git colors.
* Chamele themes use Zed capture names and support color, italics, and font weight.
* Chamele does not currently support every Shiki style, such as underlining.

The Chamele adapter should maintain its own theme-name registry and allow users to register Zed themes using Chamele-supported hex colors. The first release should not attempt to translate arbitrary TextMate scopes into Zed captures.

Chamele includes 29 built-in lexers and several aliases. Shiki offers much broader language coverage and supports custom grammars.

Diffs should keep its existing filename-based language detection, then ask the selected provider whether the resolved language is supported. The Chamele adapter should normalize compatible aliases and fall back to plain text for unsupported languages.

### Benefits

* Provides a much smaller and faster option for Chamele-supported languages.
* Keeps Shiki available for broader language coverage, TextMate fidelity, custom grammars.
* Removes Shiki-specific assumptions from renderers through a provider boundary.
* Makes additional highlighter implementations easier to add.
* Avoids asynchronous grammar loading through Chamele's fixed lexers.
* Supports SSR in node.js/bun/workerd.
* Includes compatible versions of the default Pierre light and dark themes.

### Costs and risks

* The initial refactor extends beyond adding two exports.
* Shipping both dependencies eliminate the size benefit unless the package entry graph and dependency policy are updated.
* Chamele needs a new output ABI and Unicode-offset tests before its integration can be evaluated fairly.
* Output will not be visually identical because the engines use different lexers, captures, theme formats, and styling capabilities.
* Chamele supports fewer languages and cannot load custom grammars at runtime.
* Full editor and streaming parity will require more work than static file rendering.
`,

  frontmatter: `---
title: Frontmatter, parsed in Wasm
draft: false
weight: 42
tags: [wasm, markdown, "no allocator"]
author:
  name: wat-labs
  links:
    - https://github.com/wat-labs/md
    - https://github.com/wat-labs/chamele
matrix: {rows: 3, cols: 4, sparse: true}
summary: |
  A block scalar keeps
  its line breaks.
folded: >
  A folded scalar joins
  its lines into one.
zip: "01234"
---

# The body starts here

The **Frontmatter** toggle in the header, on for this example, parses the
block above into JSON and removes it from the document. The converter only ever emits what
\`JSON.parse\` accepts, so a value like \`01234\` stays a string rather than
becoming invalid JSON.
`,

  tables: `# Tables

| Left | Center | Right | Default |
| :--- | :----: | ----: | ------- |
| a    | b      | c     | d       |
| a much longer cell | \`code\` | **bold** | [link](/u) |
| \\| escaped pipe | ~~gone~~ | 1 | |

The delimiter row decides the column count; extra cells are dropped and
missing ones are filled in.

| One |
| --- |
| 1 | 2 | 3 |
| |

A table can also start under any line of a paragraph:

Notes on the data:
| key | value |
| --- | ----- |
| n   | 42    |
`,

  lists: `# Lists

A tight list:

- one
- two
- three

A loose one, because of the blank line:

- one

- two

Ordered lists keep their start and their delimiter:

7. seven
8. eight
9. nine

Task lists:

- [ ] not done
- [x] done
  - [ ] nested, still not done

Nesting mixes freely:

1. first
   - bullet
     > quoted
     >
     > \`\`\`
     > fenced code inside a quote inside a bullet inside an item
     > \`\`\`
2. second
`,

  edge: `Setext heading
==============

Another one
-----------

    an indented code block
      keeps its relative indent

Hard-wrapped paragraphs join
into one line, unless the line
ends with two spaces
like that.

Reference links are case folded and global: [FOO], [foo], [Foo].

[fOo]: https://example.com "shared target"

Backslash escapes: \\*not emphasis\\*, \\# not a heading, \\[not a link\\].

Autolinks: <https://example.com>, <me@example.com>, www.example.com,
and http://example.com/a_b_c.

HTML passes through when it is not disallowed:

<div align="center">
  <b>raw block</b>
</div>

Inline <span title="kept">HTML</span>, but <script>alert(1)</script> is
filtered by the GFM tagfilter.
`,
};

const exampleUrls = {
  'gfm-spec':
    'https://raw.githubusercontent.com/github/cmark-gfm/0.29.0.gfm.13/test/spec.txt',
};

const exampleNames = [
  ['overview', 'Overview'],
  ['chamele', 'Chamele'],
  ['gfm-spec', 'GFM specification'],
  ['frontmatter', 'Frontmatter'],
  ['tables', 'Tables'],
  ['lists', 'Lists'],
  ['edge', 'CommonMark corners'],
];

const logoShapes = (color) =>
  `<g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="square">` +
  '<path d="M3 5H21"/><path d="M3 19H21"/><path d="M23 7V17"/><path d="M1 7V17"/>' +
  '<path d="M5 15V9H6"/><path d="M11 15V9H10"/><path d="M17 9L17 15"/>' +
  '<path d="M17 12.99L17 13"/><path d="M19 13H15"/><path d="M18 14H16"/></g>' +
  `<rect x="7" y="10" width="2" height="2" fill="${color}"/>`;

const logo = /*html*/ `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true">${logoShapes('currentColor')}</svg>`;

const favicon =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      logoShapes('#888') +
      '</svg>'
  );

const wasmInfo = `Wasm: ${format(wasmMeta['md.wasm'])} (${format(wasmMeta['md.wasm.gz'], 'gzipped')})`;

const previewCss = `
  :root { color-scheme: SCHEME; --fg: CanvasText; --muted: color-mix(in srgb, CanvasText 60%, transparent);
    --line: color-mix(in srgb, CanvasText 15%, transparent); --soft: color-mix(in srgb, CanvasText 6%, transparent);
    --accent: light-dark(#0969da, #58a6ff); }
  body { margin: 0; padding: 1.25rem 1.5rem 3rem; font: 15px/1.65 ui-sans-serif, system-ui, sans-serif;
    color: var(--fg); overflow-wrap: break-word; }
  h1, h2, h3, h4, h5, h6 { margin: 1.6em 0 .6em; line-height: 1.25; font-weight: 600; }
  h1, h2 { padding-bottom: .25em; border-bottom: 1px solid var(--line); }
  h1 { font-size: 1.8em; } h2 { font-size: 1.4em; } h3 { font-size: 1.15em; }
  :first-child { margin-top: 0; }
  a { color: var(--accent); }
  p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
  ul, ol { padding-left: 1.6em; }
  li + li { margin-top: .2em; }
  li:has(> input[type="checkbox"]) { list-style: none; }
  li input[type="checkbox"] { margin: 0 .35em 0 -1.3em; }
  blockquote { padding: 0 1em; border-left: .25em solid var(--line); color: var(--muted); }
  code { padding: .2em .4em; border-radius: 6px; background: var(--soft);
    font: .875em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { padding: 1em; overflow: auto; border-radius: 8px; background: var(--soft); }
  pre code { padding: 0; background: none; }
  table { border-collapse: collapse; display: block; overflow: auto; }
  th, td { padding: .4em .8em; border: 1px solid var(--line); }
  thead tr { background: var(--soft); }
  tbody tr:nth-child(2n) { background: var(--soft); }
  hr { height: 1px; margin: 1.6em 0; border: 0; background: var(--line); }
  img { max-width: 100%; height: auto; }
  .footnotes { margin-top: 2em; padding-top: 1em; border-top: 1px solid var(--line);
    font-size: .9em; color: var(--muted); }
  .footnote-ref a, .footnote-backref { text-decoration: none; }
`;

function page(example, source) {
  const frontmatter = example === 'frontmatter';
  let meta = null;
  let output;
  if (frontmatter) [meta, output] = renderToHtml(source, { frontmatter: true });
  else output = renderToHtml(source);
  const initialSrcdoc = escapeHtml(
    '<!doctype html><meta charset=utf-8><style>' +
      previewCss.replace('SCHEME', 'light dark') +
      '</style>' +
      new TextDecoder()
        .decode(output)
        .replaceAll('<a ', '<a target="_blank" rel="noopener" ')
  ).replaceAll('"', '&quot;');
  const pageExamples = Object.hasOwn(examples, example)
    ? examples
    : { ...examples, [example]: source };
  const exampleName = exampleNames.find(([key]) => key === example)[1];
  const initialMeta =
    meta == null
      ? ''
      : escapeHtml(JSON.stringify(meta, null, 2) ?? 'null').replace(
          /"([^"\n]*)":/g,
          '<span class="key">"$1"</span>:'
        );

  return /*html*/ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@pierre/markdowns playground</title>
<meta name="description" content="Render GitHub Flavored Markdown to HTML and to ANSI with a hand-written WebAssembly renderer.">
<link rel="icon" href="${favicon}">
<link rel="modulepreload" href="/browser.mjs">
<link rel="modulepreload" href="/index.mjs">
<link rel="modulepreload" href="/md.wasm.mjs">
<link rel="modulepreload" href="https://chamele-playground.wat-labs.com/browser.mjs" crossorigin>
<link rel="preload" href="https://chamele-playground.wat-labs.com/themes.json" as="fetch" crossorigin>
<style>
  :root {
    color-scheme: light dark;
    --panel: color-mix(in srgb, Canvas 97%, CanvasText 3%);
    --control: color-mix(in srgb, Canvas 94%, CanvasText 6%);
    --hover: color-mix(in srgb, Canvas 90%, CanvasText 10%);
    --active: color-mix(in srgb, Canvas 87%, CanvasText 13%);
    --border: color-mix(in srgb, CanvasText 12%, transparent);
    --muted: color-mix(in srgb, CanvasText 55%, transparent);
    --accent: light-dark(#0969da, #58a6ff);
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  /* several of the elements below set a display, which would otherwise win */
  [hidden] { display: none !important; }
  body {
    margin: 0;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
    background: Canvas;
    color: CanvasText;
  }
  header {
    display: flex;
    align-items: center;
    gap: .6rem;
    flex-wrap: wrap;
    padding: .5rem .85rem;
    border-bottom: 1px solid var(--border);
  }
  h1 {
    display: flex;
    align-items: center;
    gap: .5rem;
    margin: 0;
    font-size: .95rem;
    font-weight: 600;
    white-space: nowrap;
  }
  h1 .logo { width: 22px; height: 22px; }
  h1 .subtitle { font-weight: 500; color: var(--muted); }
  #version {
    padding: .15rem .5rem;
    border-radius: 6px;
    background: var(--control);
    color: var(--muted);
    font-size: .78rem;
    text-decoration: none;
  }
  #version:hover { background: var(--hover); color: CanvasText; }
  #version-info {
    inset: auto;
    margin: 0;
    padding: .35rem .55rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: Canvas;
    color: var(--muted);
    box-shadow: 0 4px 16px #0003;
    font-size: .75rem;
    line-height: 1;
    white-space: nowrap;
    pointer-events: none;
  }
  .spacer { flex: 1 1 2rem; }
  #status {
    display: flex;
    gap: .35rem;
    align-items: baseline;
    color: var(--muted);
    font-size: .78rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  #status b { font-weight: 600; color: CanvasText; }
  input[type="number"] {
    width: 4.5rem;
    height: 2rem;
    padding: 0 .5rem;
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--control);
    color: CanvasText;
    font: 500 .8rem/1 inherit;
    cursor: text;
  }
  input[type="number"]:hover { background: var(--hover); }
  .toggle {
    display: flex;
    align-items: center;
    gap: .4rem;
    height: 2rem;
    padding: 0 .6rem;
    border-radius: 8px;
    background: var(--control);
    font-size: .8rem;
    font-weight: 500;
    user-select: none;
    cursor: pointer;
  }
  .toggle:hover { background: var(--hover); }
  .toggle input { margin: 0; accent-color: var(--accent); }
  .tabs {
    display: flex;
    gap: .15rem;
    padding: .15rem;
    border-radius: 9px;
    background: var(--control);
  }
  .tabs button {
    padding: .3rem .65rem;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--muted);
    font: 500 .8rem/1.4 inherit;
    cursor: pointer;
  }
  .tabs button:hover { color: CanvasText; }
  .tabs button[aria-selected="true"] {
    background: Canvas;
    color: CanvasText;
    box-shadow: 0 1px 3px #0002;
  }
  .picker { display: flex; }
  .picker-trigger {
    display: flex;
    align-items: center;
    gap: .45rem;
    height: 2rem;
    max-width: 13rem;
    padding: 0 .55rem;
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--control);
    color: CanvasText;
    font: 500 .8rem/1 inherit;
    cursor: pointer;
  }
  .picker-trigger:hover { background: var(--hover); }
  .picker-trigger:focus-visible {
    outline: 2px solid color-mix(in srgb, CanvasText 65%, transparent);
    outline-offset: 2px;
  }
  .picker-trigger[aria-expanded="true"] {
    border-color: var(--border);
    background: var(--active);
  }
  .picker-trigger svg { flex: none; width: 1rem; height: 1rem; }
  .picker-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .picker-chevron { margin-left: .15rem; opacity: .55; transition: transform 120ms ease; }
  .picker-trigger[aria-expanded="true"] .picker-chevron { transform: rotate(180deg); }
  .picker-menu {
    position: fixed;
    inset: auto;
    width: min(16rem, calc(100vw - 1rem));
    max-height: min(31rem, calc(100vh - 4rem));
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    color: CanvasText;
    opacity: 0;
    transform: translateY(-4px) scale(.98);
    transition: opacity 120ms ease, transform 120ms ease, overlay 120ms allow-discrete, display 120ms allow-discrete;
  }
  .picker-menu:popover-open {
    display: flex;
    flex-direction: column;
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  @starting-style {
    .picker-menu:popover-open { opacity: 0; transform: translateY(-4px) scale(.98); }
  }
  .picker-menu::backdrop { background: transparent; }
  .picker-options {
    position: relative;
    min-height: 0;
    padding: .4rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }
  .picker-highlight {
    position: absolute;
    z-index: 0;
    top: 0;
    left: .6rem;
    right: .6rem;
    height: 0;
    border-radius: 7px;
    background: var(--hover);
    opacity: 0;
    pointer-events: none;
    transform: translateY(0);
  }
  @media (hover: hover) and (pointer: fine) {
    .picker-options:hover .picker-highlight {
      transition: background-color 120ms ease, height 120ms ease, opacity 80ms ease, transform 120ms ease;
    }
  }
  .picker-highlight.active { background: var(--active); }
  .picker-option {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: .55rem;
    width: 100%;
    min-height: 2rem;
    padding: .45rem 1.6rem .45rem .55rem;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    font: 400 .8rem/1.25 inherit;
    text-align: left;
    cursor: pointer;
  }
  .picker-option:focus-visible { outline: 0; }
  .picker-option[aria-selected="true"] { font-weight: 650; }
  .picker-option[aria-selected="true"]::after {
    content: "";
    position: absolute;
    top: 50%;
    right: .55rem;
    width: .9rem;
    height: .9rem;
    background: currentColor;
    clip-path: circle(.21rem);
    transform: translateY(-50%);
  }
  .icon-btn {
    display: flex;
    padding: .35rem;
    border-radius: 6px;
    color: var(--muted);
  }
  .icon-btn:hover { background: var(--control); color: CanvasText; }
  main {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    min-height: 0;
  }
  #input {
    width: 100%;
    height: 100%;
    padding: 1rem;
    border: 0;
    border-right: 1px solid var(--border);
    outline: 0;
    resize: none;
    background: Canvas;
    color: CanvasText;
    font: 13px/1.6 var(--mono);
    tab-size: 4;
  }
  #input::selection { background: light-dark(rgba(35, 131, 226, .18), rgba(88, 166, 255, .32)); }
  #panes { position: relative; display: flex; flex-direction: column; min-width: 0; }
  #meta {
    flex: none;
    max-height: 32%;
    overflow: auto;
    margin: 0;
    padding: .7rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    font: 12px/1.5 var(--mono);
    white-space: pre-wrap;
  }
  #meta .key { color: var(--accent); }
  #meta .err { color: light-dark(#b3261e, #ff7b72); }
  /* Chrome reloads an iframe whose box is torn down, and a reload of a
     src-less frame lands on about:blank, so the panes are stacked and swapped
     with visibility rather than with display. */
  #views { position: relative; flex: 1; min-height: 0; }
  .pane { position: absolute; inset: 0; overflow: auto; visibility: hidden; }
  .pane.active { visibility: visible; }
  #preview { width: 100%; height: 100%; border: 0; background: Canvas; }
  #ansi-pane { padding: 1rem; background: #0b0d10; }
  #ansi {
    margin: 0;
    padding: 0;
    color: #d4d7dd;
    font: 14px/1.25 var(--mono);
    white-space: pre;
  }
  /* A box character is only drawn across the font's ascent-to-descent band,
     which is shorter than the line box, so a run of them is stretched to close
     the gap the leading would otherwise leave between two rows. */
  #ansi .rule { display: inline-block;}
  @media (width < 55rem) {
    main { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); }
    #input { border-right: 0; border-bottom: 1px solid var(--border); }
  }
</style>
</head>
<body>
<svg width="0" height="0" style="position: absolute" aria-hidden="true">
  <symbol id="icon-chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M12 16.99L12 17"/><path d="M10 14.99L10 15"/><path d="M14 14.99L14 15"/><path d="M16 12.99L16 13"/><path d="M8 12.99L8 13"/><path d="M6 10.99L6 11"/><path d="M18 10.99L18 11"/><path d="M20 8.99L20 9"/><path d="M4 8.99L4 9"/></symbol>
</svg>
<header>
  <h1>${logo} @pierre/markdowns <span class="subtitle">Playground</span></h1>
  <a id="version" href="https://github.com/wat-labs/md/releases/tag/v${pkg.version}" aria-describedby="version-info">v${pkg.version}</a>
  <div id="version-info" popover="hint" role="tooltip">${wasmInfo}</div>
  <div class="spacer"></div>
  <span id="status" hidden></span>
  <label class="toggle" id="frontmatter-field"${
    frontmatter ? '' : ' hidden'
  } title="Parse a leading YAML block and hand it back as an object">
    <input type="checkbox" id="frontmatter"${frontmatter ? ' checked' : ''}> Frontmatter
  </label>
  <label class="toggle" id="width-field" hidden title="Wrap width for the terminal backend">
    Width <input type="number" id="width" value="80" min="20" max="200" step="1">
  </label>
  <div class="picker">
    <button class="picker-trigger" id="example-trigger" type="button" popovertarget="example-menu" aria-haspopup="listbox" aria-controls="example-options" aria-expanded="false">
      <span class="picker-label" id="example-label">${escapeHtml(exampleName)}</span>
      <svg class="picker-chevron" aria-hidden="true"><use href="#icon-chevron-down"></use></svg>
    </button>
    <div class="picker-menu" id="example-menu" popover>
      <div class="picker-options" id="example-options" role="listbox" aria-label="Example document"><div class="picker-highlight" id="example-highlight" aria-hidden="true"></div>${pickerOptions(
        exampleNames,
        'example',
        example
      )}</div>
    </div>
  </div>
  <div class="tabs" role="tablist" aria-label="Output">
    <button role="tab" data-view="preview" aria-selected="true">HTML</button>
    <button role="tab" data-view="ansi" aria-selected="false">Terminal</button>
  </div>
  <a class="icon-btn" href="https://github.com/wat-labs/md" target="_blank" rel="noopener" title="GitHub" aria-label="GitHub repository">
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z"/></svg>
  </a>
</header>
<main>
  <textarea id="input" spellcheck="false" aria-label="Markdown source">${escapeHtml(source)}</textarea>
  <div id="panes">
    <pre id="meta"${meta == null ? ' hidden' : ''}>${initialMeta}</pre>
    <div id="views">
      <iframe id="preview" class="pane active" sandbox="allow-popups allow-popups-to-escape-sandbox" title="Rendered markdown" srcdoc="${initialSrcdoc}"></iframe>
      <div id="ansi-pane" class="pane"><pre id="ansi"></pre></div>
    </div>
  </div>
</main>
<script type="module">
  import { renderToAnsi, renderToHtml } from "/browser.mjs";
  import { codeToHtml } from "https://chamele-playground.wat-labs.com/browser.mjs";

  const examples = ${serialize(pageExamples)};
  const exampleUrls = ${serialize(exampleUrls)};
  const input = document.getElementById("input");
  const panes = {
    preview: document.getElementById("preview"),
    ansi: document.getElementById("ansi-pane"),
  };
  const ansi = document.getElementById("ansi");
  const meta = document.getElementById("meta");
  const status = document.getElementById("status");
  const frontmatterField = document.getElementById("frontmatter-field");
  const frontmatter = document.getElementById("frontmatter");
  const widthField = document.getElementById("width-field");
  const width = document.getElementById("width");
  const examplePicker = getPicker("example");
  const version = document.getElementById("version");
  const versionInfo = document.getElementById("version-info");
  const tabs = [...document.querySelectorAll(".tabs button")];
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const entityDecoder = document.createElement("textarea");
  const themeResponse = await fetch("https://chamele-playground.wat-labs.com/themes.json");
  if (!themeResponse.ok) throw new Error("Could not load Chamele themes: HTTP " + themeResponse.status);
  const { pierreDark: darkTheme, pierreLight: lightTheme } = await themeResponse.json();
  const highlightThemes = { dark: darkTheme, light: lightTheme };
  let view = "preview";
  let example = ${serialize(example)};
  let exampleStatus = "";

  function getPicker(name) {
    return {
      name,
      trigger: document.getElementById(name + "-trigger"),
      menu: document.getElementById(name + "-menu"),
      label: document.getElementById(name + "-label"),
      options: document.getElementById(name + "-options"),
      highlight: document.getElementById(name + "-highlight"),
      selected: null,
      highlighted: null,
    };
  }

  function selectPicker(picker, key) {
    picker.selected ??= picker.menu.querySelector('[aria-selected="true"]');
    if (picker.selected) {
      picker.selected.setAttribute("aria-selected", "false");
      picker.selected.tabIndex = -1;
    }
    picker.selected = picker.menu.querySelector("[data-" + picker.name + '="' + key + '"]');
    picker.selected.setAttribute("aria-selected", "true");
    picker.selected.tabIndex = 0;
    picker.label.textContent = picker.selected.textContent;
    picker.trigger.title = picker.selected.textContent;
  }

  // One shared rectangle that slides between the options, which are offset
  // against the positioned list around them.
  function movePickerHighlight(picker, option) {
    picker.highlighted = option;
    if (!option) {
      picker.highlight.style.opacity = 0;
      return;
    }
    picker.highlight.style.height = option.offsetHeight + "px";
    picker.highlight.style.transform = "translateY(" + option.offsetTop + "px)";
    picker.highlight.style.opacity = 1;
    picker.highlight.classList.toggle("active", option === picker.selected);
  }

  const previewCss = ${serialize(previewCss)};

  // The renderer emits the SGR codes below; anything else is passed over.
  const CUBE = [0, 95, 135, 175, 215, 255];
  function xterm(n) {
    if (n < 16) {
      const base = [0, 205, 60, 205, 90, 205, 40, 200, 120, 255, 100, 255, 130, 255, 90, 255];
      const c = [[0,0,0],[205,49,49],[13,188,121],[229,229,16],[36,114,200],[188,63,188],[17,168,205],[229,229,229],
        [102,102,102],[241,76,76],[35,209,139],[245,245,67],[59,142,234],[214,112,214],[41,184,219],[255,255,255]][n];
      return "rgb(" + c.join() + ")";
    }
    if (n < 232) {
      n -= 16;
      return "rgb(" + [CUBE[(n / 36) | 0], CUBE[((n / 6) | 0) % 6], CUBE[n % 6]].join() + ")";
    }
    return "rgb(" + Array(3).fill(8 + (n - 232) * 10).join() + ")";
  }

  // every box character the renderer emits except the plain horizontal, which
  // spans no leading and stays crisp unscaled
  const RULES = /[\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c]+/g;

  function ansiToHtml(text) {
    const style = { bold: false, dim: false, italic: false, underline: false, strike: false, color: "" };
    let out = "";
    let last = 0;
    const re = /\\x1b\\[([0-9;]*)m/g;
    const flush = (end) => {
      if (end <= last) return;
      const chunk = text.slice(last, end).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(RULES, '<span class="rule">$&</span>');
      const css = [];
      if (style.bold) css.push("font-weight:600");
      if (style.dim) css.push("color:color-mix(in srgb, CanvasText 60%, currentColor)");
      if (style.italic) css.push("font-style:italic");
      if (style.underline) css.push("text-decoration:underline");
      if (style.strike) css.push("text-decoration:line-through");
      if (style.color) css.push("color:" + style.color);
      out += css.length ? '<span style="' + css.join(";") + '">' + chunk + "</span>" : chunk;
    };
    for (let m; (m = re.exec(text));) {
      flush(m.index);
      const codes = m[1].split(";").map(Number);
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) Object.assign(style, { bold: false, dim: false, italic: false, underline: false, strike: false, color: "" });
        else if (c === 1) style.bold = true;
        else if (c === 2) style.dim = true;
        else if (c === 3) style.italic = true;
        else if (c === 4) style.underline = true;
        else if (c === 9) style.strike = true;
        else if (c === 38 && codes[i + 1] === 5) { style.color = xterm(codes[i + 2] || 0); i += 2; }
      }
      last = re.lastIndex;
    }
    flush(text.length);
    return out;
  }

  function showMeta(value, error) {
    if (!frontmatter.checked || (value == null && !error)) {
      meta.hidden = true;
      return;
    }
    meta.hidden = false;
    if (error) {
      meta.innerHTML = '<span class="err">' + escapeHtml(error) + "</span>";
      return;
    }
    const json = JSON.stringify(value, null, 2) ?? "null";
    meta.innerHTML = escapeHtml(json).replace(/"([^"\\n]*)":/g, '<span class="key">"$1"</span>:');
  }

  const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  function render() {
    const source = input.value;
    const bytes = encoder.encode(source).length;
    const options = view === "ansi"
      ? { width: Math.min(Math.max(+width.value || 80, 20), 200) }
      : { frontmatter: frontmatter.checked };
    let out, data = null, error = "";
    // the mean of as many runs as fit in a few milliseconds: a single
    // sub-millisecond sample is mostly timer granularity
    let ms = 0;
    try {
      const start = performance.now();
      let runs = 0;
      do {
        const result = view === "ansi" ? renderToAnsi(source, options) : renderToHtml(source, options);
        if (options.frontmatter) [data, out] = result;
        else out = result;
        out = decoder.decode(out);
        ms = performance.now() - start;
      } while (++runs < 64 && ms < 6);
      ms /= runs;
    } catch (err) {
      error = String(err);
      out = "";
      ms = 0;
    }

    showMeta(data, error);
    if (view === "preview") {
      const scheme = dark.matches ? "dark" : "light";
      out = out.replace(/<pre><code class="language-([^"]+)">([^]*?)<[/]code><[/]pre>/g, (block, lang, code) => {
        entityDecoder.innerHTML = code;
        try {
          return decoder.decode(codeToHtml(entityDecoder.value, {
            lang,
            theme: highlightThemes[scheme],
          }));
        } catch {
          // Keep the renderer's escaped code block when Chamele does not support the language.
          return block;
        }
      });
      panes.preview.srcdoc = "<!doctype html><meta charset=utf-8><style>"
        + previewCss.replace("SCHEME", scheme) + "</style>"
        + out.replaceAll("<a ", '<a target="_blank" rel="noopener" ');
    } else {
      ansi.innerHTML = ansiToHtml(out);
    }

    const time = ms < 1 ? (ms * 1e3).toFixed(0) + " \u00b5s" : ms.toFixed(2) + " ms";
    const rate = ms > 0 ? (bytes / (ms / 1000) / 1e6).toFixed(0) + " MB/s" : "";
    if (exampleStatus) {
      if (status.textContent !== exampleStatus) status.textContent = exampleStatus;
    } else status.innerHTML = bytes.toLocaleString() + " B in <b>" + time + "</b> \u00b7 <b>" + rate + "</b>";
    status.hidden = !!error && !exampleStatus;
  }

  // Width belongs to the terminal backend, frontmatter to the HTML one, and
  // only the frontmatter example has a block to parse.
  function syncFields() {
    widthField.hidden = view !== "ansi";
    frontmatterField.hidden = view === "ansi" || example !== "frontmatter";
  }

  function selectView(next) {
    view = next;
    for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.view === next));
    for (const [name, pane] of Object.entries(panes)) pane.classList.toggle("active", name === next);
    syncFields();
    render();
  }

  async function selectExample(key) {
    example = key;
    selectPicker(examplePicker, key);
    frontmatter.checked = key === "frontmatter";
    exampleStatus = "";
    status.removeAttribute("role");
    input.removeAttribute("aria-busy");
    syncFields();

    let source = examples[key];
    if (source == null) {
      source = examples[key] = fetch(exampleUrls[key]).then((response) => {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.text();
      });
    }
    if (typeof source !== "string") {
      input.disabled = true;
      input.value = "";
      input.placeholder = "Loading " + key + " ...";
      input.setAttribute("aria-busy", "true");
      status.textContent = "";
      status.setAttribute("role", "status");
      exampleStatus = "Loading " + key + " ...";
      render();
      try {
        source = examples[key] = await source;
      } catch (error) {
        delete examples[key];
        if (example !== key) return;
        input.disabled = false;
        input.placeholder = "Could not load example";
        input.removeAttribute("aria-busy");
        exampleStatus = "Could not load example · " + error;
        render();
        return;
      }
      if (example !== key) return;
    }
    input.disabled = false;
    input.placeholder = "";
    input.removeAttribute("aria-busy");
    status.removeAttribute("role");
    exampleStatus = "";
    input.value = source;
    input.scrollTop = 0;
    render();
  }

  for (const tab of tabs) tab.addEventListener("click", () => selectView(tab.dataset.view));
  for (const picker of [examplePicker]) {
    picker.menu.addEventListener("toggle", () => {
      const open = picker.menu.matches(":popover-open");
      picker.trigger.setAttribute("aria-expanded", String(open));
      if (!open) return;
      const rect = picker.trigger.getBoundingClientRect();
      picker.menu.style.top =
        Math.max(8, Math.min(rect.bottom + 4, innerHeight - picker.menu.offsetHeight - 8)) + "px";
      picker.menu.style.left =
        Math.max(8, Math.min(rect.right - picker.menu.offsetWidth, innerWidth - picker.menu.offsetWidth - 8)) + "px";
      picker.selected.scrollIntoView({ block: "center", inline: "nearest" });
      movePickerHighlight(picker, picker.selected);
      picker.selected.focus();
    });
    picker.menu.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const options = [...picker.menu.querySelectorAll(".picker-option")];
      let index = options.indexOf(document.activeElement);
      if (event.key === "ArrowDown") index = index < 0 ? 0 : Math.min(index + 1, options.length - 1);
      if (event.key === "ArrowUp") index = index < 0 ? 0 : Math.max(index - 1, 0);
      if (event.key === "Home") index = 0;
      if (event.key === "End") index = options.length - 1;
      event.preventDefault();
      options[index]?.focus();
    });
    picker.options.addEventListener("pointermove", (event) => {
      const option = event.target.closest(".picker-option") ?? picker.selected;
      if (option !== picker.highlighted) movePickerHighlight(picker, option);
    });
    picker.options.addEventListener("pointerleave", () => movePickerHighlight(picker, picker.selected));
    picker.options.addEventListener("focusin", (event) => {
      const option = event.target.closest(".picker-option");
      if (option) movePickerHighlight(picker, option);
    });
  }
  examplePicker.menu.addEventListener("click", (event) => {
    const option = event.target.closest("[data-example]");
    if (!option) return;
    examplePicker.menu.hidePopover();
    examplePicker.trigger.focus();
    const key = option.dataset.example;
    const url = new URL(location.href);
    if (key === "overview") url.searchParams.delete("doc");
    else url.searchParams.set("doc", key);
    if (url.href !== location.href) history.pushState(null, "", url);
    if (key !== example) selectExample(key);
  });
  addEventListener("popstate", () => {
    const requested = new URLSearchParams(location.search).get("doc");
    const key = Object.hasOwn(examples, requested) || Object.hasOwn(exampleUrls, requested)
      ? requested
      : "overview";
    if (key !== example) selectExample(key);
  });
  input.addEventListener("input", () => {
    exampleStatus = "";
    status.removeAttribute("role");
    input.placeholder = "";
    render();
  });
  frontmatter.addEventListener("change", render);
  width.addEventListener("input", render);
  dark.addEventListener("change", render);

  const showInfo = () => {
    const rect = version.getBoundingClientRect();
    versionInfo.style.top = rect.bottom + 6 + "px";
    versionInfo.style.left = rect.left + "px";
    if (!versionInfo.matches(":popover-open")) versionInfo.showPopover();
  };
  const hideInfo = () => versionInfo.matches(":popover-open") && versionInfo.hidePopover();
  version.addEventListener("pointerenter", showInfo);
  version.addEventListener("pointerleave", hideInfo);
  version.addEventListener("focus", showInfo);
  version.addEventListener("blur", hideInfo);

  if (document.readyState === "complete") selectExample(example);
  else addEventListener("load", () => selectExample(example), { once: true });
</script>
</body>
</html>
`;
}

function pickerOptions(options, type, selected) {
  return options
    .map(([value, name]) => {
      const active = value === selected;
      return (
        `<button class="picker-option" type="button" role="option" aria-selected="${active}"` +
        ` tabindex="${active ? 0 : -1}" data-${type}="${value}"><span>${escapeHtml(name)}</span></button>`
      );
    })
    .join('');
}

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
}

function serialize(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028');
}

function format(bytes, suffix = 'bytes') {
  return bytes.toLocaleString('en-US') + ' ' + suffix;
}

export default {
  async fetch(request) {
    const requested = new URL(request.url).searchParams.get('doc');
    const example =
      Object.hasOwn(examples, requested) ||
      Object.hasOwn(exampleUrls, requested)
        ? requested
        : 'overview';
    let source = examples[example];
    if (source == null) {
      const response = await fetch(exampleUrls[example]);
      if (!response.ok)
        return new Response('Could not load example', { status: 502 });
      source = await response.text();
    }
    return new Response(page(example, source), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Added COOP/COEP headers to enable cross-origin isolation.
        // This improves performance.now() resolution from 100 µs to roughly 5 µs.
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      },
    });
  },
};
