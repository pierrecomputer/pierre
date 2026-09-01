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
existing consumers. `setHighlighter` swaps the implementation used by
subsequently created files, diffs, streams, editors, React components, and SSR
renderers; instances that already exist keep the implementation they captured.

The experimental [chamele]-backed highlighter runs its lexers in WebAssembly
with no async grammar or theme loading. Install the optional `@pierre/chamele`
peer dependency, then:

```ts
import { File, setHighlighter } from '@pierre/diffs';
import { chameleHighlighter } from '@pierre/diffs/chamele';

setHighlighter(chameleHighlighter);
const file = new File(); // use the chamele highlighter
```

Pass the `shikiHighlighter` export back to `setHighlighter` to restore the
default. Custom implementations conform to the `CodeHighlighter` interface
exported from `@pierre/diffs`. Notes on the chamele highlighter:

- Theme names map onto chamele's bundled Zed themes; register custom names with
  `registerChameleTheme` from `@pierre/diffs/chamele`.
- Languages without a chamele lexer render as plain text.
- The worker pool always highlights with shiki, so a registered custom
  highlighter routes rendering to the main thread (chamele is fast enough that
  this is not a regression).
- Edit mode tokenizes through chamele's incremental `LiveTokenizer` instead of
  the TextMate incremental tokenizer.

[shiki]: https://shiki.style
[chamele]: ../chamele/README.md

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
