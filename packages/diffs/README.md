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

## Development

Technically you can use the package manager of your choice, but we use
[bun](https://bun.sh/).

```bash
# From the root of the mono repo: setup dependencies
bun install

# Start the demo vite test server from root
bun run demo:dev

# To run the docs from root
bun run docs:dev
```

### Testing

```bash
# Run tests and related command from within the package directory
bun test

# Update snapshots
bun test --update-snapshots

# Type checking
bun run tsc
```

Tests are located in the `test/` folder and use Bun's native testing framework
with snapshot support.

## Publishing

**Applicable to the Pierre team only.**

```bash
# You may need to login with npm first:
npm login

# Always run publish from within the package directory
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
