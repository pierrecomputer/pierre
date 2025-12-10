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
bun i @pierre/diffs
```

## Dev

Technically you can use the package manager of your choice, but we use
[bun](https://bun.sh/).

```bash
# Setup dependencies
bun install

# Start local development server
bun run dev
```

## Testing

Run tests for the diffs package:

```bash
# Run tests
bun run diffs:test

# Update snapshots
bun run diffs:update-snapshots
```

## Publishing

**For Pierre team only.**

```sh
cd packages/diffs
bun publish
```

## Building Icons

**For Pierre team only.**

To build all our SVG icons from Figma there's a couple preparation steps that
you need to run first.

Perform a full export of all `Published Icons` the `Pierre Design` Figma file

Do this by selecting all the icons but not the art board and in the bottom right
click `Export XXX Layers` and make sure to point it to a `./svg` folder at the
root level of this project

Once that's done, simply run:

```bash
bun run icons:build
```

This will run a full build of all the icons into
`./apps/docs/components/icons/icons`

Then make sure to check in any changes needed
