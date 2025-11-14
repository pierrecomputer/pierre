# PierreJS R&D

Spinning up a small repo to experiment with various ideas and such for PierreJS.

## Dev

Technically you can use the package manager of your choice, but I setup the
project using [bun](https://bun.sh/) and all example commands assume bun.

```bash
# Setup Dependencies
bun install

# Development
bun run dev
```

## Publishing precision diffs

```sh
cd packages/precision-diffs
bun publish
```

## Building Icons

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
