# Diffs, from Pierre

`@pierre/diffs` is an open source diff and file rendering library built on
[Shiki](https://shiki.style/). It's super customizable and packed with the
features you need. Made with love by
[The Pierre Computer Company](https://pierre.computer). Available as vanilla
JavaScript and React components.

**View examples and read documentation on [Diffs.com](https://diffs.com).**

## Features

- Diff file versions, patches, and arbitrary files
- Split or stacked layout
- Automatically adapts to Shiki themes
- Supports light and dark mode
- Options for diff highlight styles, in-line highlighting, wrapping, line
  numbers, and more
- Supports custom fonts and `font-feature-settings`
- Flexible annotation framework for injecting comments, annotations, and more
- Add your own accept/reject changes UI
- Select and highlight lines

## Install

```bash
pnpm add @pierre/diffs
```

## Highlighters

`@pierre/diffs` highlights with [shiki] out of the box — nothing changes for
existing consumers. `setHighlighter` swaps the implementation for everything
rendered afterwards: newly created files, diffs, streams, editors, React
components, and SSR renderers use it, and an existing file or diff renderer
adopts it the next time something makes it render (its caches are keyed by the
registration, so stale markup is never served — but nothing repaints
spontaneously on the call itself). Already-running streams and attached editors
keep the implementation they captured until they are re-created.

The experimental [highlights]-backed highlighter runs its built-in lexers in
WebAssembly and lazy-loads bundled themes by ID.

```ts
import { File, setHighlighter } from '@pierre/diffs';
import { highlightsHighlighter } from '@pierre/diffs/highlights';

setHighlighter(highlightsHighlighter);
const file = new File(); // use the highlights highlighter
```

Pass the `shikiHighlighter` export back to `setHighlighter` to restore the
default. Custom implementations conform to the `CodeHighlighter` interface
exported from `@pierre/diffs`. Notes on the highlights highlighter:

- Theme names map onto highlights's bundled Zed themes; register custom names
  with `registerHighlightsTheme` from `@pierre/diffs/highlights`.
- Languages without a highlights lexer render as plain text.
- The worker pool always highlights with shiki, so a registered custom
  highlighter routes rendering to the main thread (highlights is fast enough
  that this is not a regression).
- Edit mode tokenizes through highlights's incremental `LiveTokenizer` instead
  of the TextMate incremental tokenizer.

[shiki]: https://shiki.style
[highlights]: ../highlights/README.md

## Agent skill

Install the agent skill for this package with the
[Skills CLI](https://skills.sh/docs/cli):

```bash
npx skills add pierrecomputer/pierre --skill diffs
```

## Development

We use pnpm for workspace package management and Bun for tests.

```bash
# From the root of the monorepo: setup dependencies
pnpm install

# Start the demo vite test server
moonx demo:dev

# To run the docs (diffs site)
moonx docs:dev-diffs
```

### Testing

```bash
# Run tests and related command from within the package directory
bun test

# Update snapshots
bun test --update-snapshots

# Type checking
moonx diffs:typecheck
```

Tests are located in the `test/` folder and use Bun's native testing framework
with snapshot support.

## Publishing

**Applicable to the Pierre team only.**

```bash
# You may need to login first:
pnpm login

# Always run publish from within the package directory.
cd packages/diffs
pnpm publish
# In a CI-marked shell: CI= pnpm publish
```

## Building the sprite

The diff UI uses an SVG sprite built from `@pierre/icons`. From the monorepo
root:

```bash
moonx root:icons
```

This reads SVGs from `node_modules/@pierre/icons/svg` and writes
`packages/diffs/src/sprite.ts`. Run after updating `@pierre/icons` or changing
`sprite.config.js`.

## Rendering tokens

`tokensToHtml` renders themed token lines from any `codeToTokens` highlighter.
It escapes text and attributes, preserves token styles, and separates lines with
newlines. It does not add line, `code`, or `pre` wrappers.

```ts
import { tokensToHtml } from '@pierre/diffs';

const html = tokensToHtml(tokens, {
  transformers: [
    {
      tokens(lines) {
        for (const line of lines) {
          for (const token of line) {
            token.htmlAttrs = { ...token.htmlAttrs, class: 'syntax-token' };
          }
        }
      },
    },
  ],
});
```

Token hooks can mutate the tokens or return a replacement array. Hooks run in
`enforce: 'pre'`, normal, then `enforce: 'post'` order, preserving their order
within each tier. Only the Shiki-style `tokens(lines)` hook is supported; node
hooks and Shiki's highlighter context are not available. Component options do
not accept these transformers.

Custom `CodeHighlighter` implementations supply `codeToTokens`; diffs owns HTML
rendering. Highlighting results and worker caches contain `ThemedToken[][]`.
Renderers serialize visible tokens with current line attributes and diff
decorations; `renderCode` returns gutter/content rows and `renderFullHTML`
returns the complete markup. The previous AST methods and utilities have been
removed.
