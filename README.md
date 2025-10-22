# PierreJS R&D

Spinning up a small repo to experiment with various ideas and such for PierreJS.

## Dev

Technically you can use the package manager of your choice, but I setup the
project using [bun](https://bun.sh/) and all example commands assume bun.

```bash
# Seup Dependencies
bun install

# Development
bun run dev
```

## Publishing precision diffs

Note that publishing precision diffs is a bit artisinal.

**This is dangerous.**

First run `bun run clean` at root then `cd` into the package directory

```bash
bun run clean
cd packages/precision-diffs
```

Next modify exports to both increment the version and update exports/files like
so:

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"]
}
```

Run build, followed by a publish:

```bash
bun run build
bun publish
```

After the version has been deployed, revert the exports/files changes in
package.json.

Long term, I'm hoping we can use publishConfig to override this, but because we
rely on Bun for package managment, we currently don't have this functionality.

## Building Icons

To build all our SVG icons from figma there's a couple preparation steps that
you need to run first.

Perform a full export of all `Published Icons` the `Pierre Design` figma file

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
