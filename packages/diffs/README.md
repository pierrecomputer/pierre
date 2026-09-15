# Diffs, from Pierre

`@pierre/diffs` is an open source diff and file rendering library with
Highlights and Shiki backends. It's super customizable and packed with the
features you need. Made with love by
[The Pierre Computer Company](https://pierre.computer). Available as vanilla
JavaScript and React components.

**View examples and read documentation on [Diffs.com](https://diffs.com).**

## Features

- Diff file versions, patches, and arbitrary files
- Split or stacked layout
- Uses the selected highlighter's themes
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

Highlights is the default highlighter. Set `preferredHighlighter` to
`'shiki-wasm'` or `'shiki-js'` in file, diff, or worker pool options to use
Shiki. Each backend loads on demand through
`@pierre/diffs/highlighter/highlights`, `@pierre/diffs/highlighter/shiki-wasm`,
or `@pierre/diffs/highlighter/shiki-js`; Shiki themes and languages also load on
demand. Both Shiki engines support incremental editor and stream tokenization.
Custom theme loaders should return the selected backend's theme format.

Register theme loaders with `registerCustomTheme` before using their name in
file, diff, or worker pool options:

```ts
import { registerCustomTheme } from '@pierre/diffs';
import type { Theme } from '@pierre/highlights';
import type { ThemeRegistrationAny } from 'shiki/core';

const textmateTheme: ThemeRegistrationAny = {
  name: 'my-theme',
  type: 'dark',
  colors: { 'editor.background': '#181818', 'editor.foreground': '#eeeeee' },
  tokenColors: [{ scope: 'keyword', settings: { foreground: '#ff88aa' } }],
};
const zedTheme: Theme = {
  name: 'my-theme',
  appearance: 'dark',
  style: {
    'editor.background': '#181818',
    'editor.foreground': '#eeeeee',
    syntax: { keyword: { color: '#ff88aa' } },
  },
};

registerCustomTheme('my-theme', async () => textmateTheme, 'textmate'); // shiki-wasm and shiki-js
registerCustomTheme('my-theme', async () => zedTheme, 'zed'); // highlights
```

Names are registered separately for each format. Registration does not load a
highlighter; themes are resolved when requested. Duplicate names within a format
are logged and ignored. Omit the optional third argument to register a loader
for all backends; its result must match the selected backend's theme format.

Register custom Shiki languages with `registerCustomLanguage`. Both Shiki
engines load the grammar on demand; Highlights ignores the loader.

```ts
import { registerCustomLanguage } from '@pierre/diffs';

registerCustomLanguage('my-language', () => import('./my-language'), [
  'mylang',
]);
```

The loader must return a module whose default export is an array of Shiki
grammars. One grammar must declare the registered name in its `name` or
`aliases`. The optional third argument maps filenames or extensions without a
leading dot, including compound extensions. Register aliases before loading
their grammar; Shiki cannot add aliases to a grammar it has already loaded.
Custom grammars are also passed to Shiki worker pools when requested.

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
