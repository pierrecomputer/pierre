PIERRE COMPUTER COMPANY █ PROJECT: DIFFS HIGHLIGHT

```

CONTACT: SUPPORT@PIERRE.CO
LOCATION: USA
STATUS: ONLINE
OPEN POSITIONS: [Systems Engineer](https://pierre.computer/careers/systems-engineer)

```

Overview:

- A Figma plugin that syntax highlights code in a text layer by binding the
  Pierre `syntax/*` variables to each token's characters.
- Because the colors come from variables rather than hex values, switching the
  collection's mode re-colors the code: light, dark, soft, and both CVD variants
  from one sample.
- Local development only. This is not published to the Figma Community.

## Setup

The plugin is loaded from disk, so it has to be built first:

```bash
moonx diffs-highlight:build
```

Then in Figma desktop: **Plugins > Development > Import plugin from manifest**,
and select `packages/diffs-highlight/manifest.json`.

The variables have to be reachable from the file you run it on, either way
described in [Where the variables come from](#where-the-variables-come-from):
imported into the file from [`@pierre/theme`](../theme/README.md) — the
primitives collection, then the semantic collection with one mode per variant —
or published by a library that the file has enabled.

## Usage

1. Select one or more text layers containing code. Non-text layers and empty
   text layers in the selection are ignored rather than rejected.
2. Run **Plugins > Development > Diffs Highlight**.
3. Pick the language, confirm the variable collection, and press **Highlight**.
   Every selected layer is tokenized as that one language, so group a
   multi-layer run by language.
4. Switch that collection's mode on the layer (or its parent frame) to move the
   sample between Light, Dark, Soft, and the CVD variants.

Every language Shiki bundles is offered — 235 of them, listed alphabetically by
display name, so the select relies on type-ahead. The picker opens on
TypeScript.

The status line reports what happened: how many ranges were bound and across how
many layers, any colors that matched no Pierre role, and any variable names
missing from the collection you picked (usually the sign of a partial import, or
the wrong collection). A layer edited between tokenizing and binding is skipped
and named, rather than costing you the rest of the selection.

## Where the variables come from

The picker offers collections from two places, grouped by source once both are
present:

- **This file** — collections defined locally, from importing the token JSON
  into it.
- **A library** — collections published by any library the file has enabled,
  listed under the library's name.

A library has to be enabled through Figma's own UI (**Assets > Libraries**, or
the file's library settings). The plugin cannot enable one, and Figma's API only
reports libraries that are already enabled, so a library that is not showing up
is almost always one that is not enabled for this file.

Library variables are not bindable as they are — they have to be imported into
the file by key first. The plugin does that on demand when you press
**Highlight**, for the roles that run actually uses rather than the whole
collection, which is also what links the file to the library so the variables
keep updating with it. Reaching them at all needs
`"permissions": ["teamlibrary"]` in `manifest.json`; without it the API is
absent entirely, and the status line says so instead of silently listing
nothing.

Since a library collection does not report its modes through the API, those
options carry no mode count. Modes still work when you switch them on the layer;
they just cannot be counted up front.

## How a color becomes a variable

Shiki returns a resolved color per token, but binding a variable needs a role
name like `syntax/keyword`. All eight Pierre variants share one scope table and
differ only in resolved color, so the plugin always tokenizes with `pierre-dark`
as a probe — its 18 `syntax/*` colors are all distinct, where the tritanopia
variants collapse five of them into one — looks the role up by that color, and
binds by name. Figma then resolves the color for whichever mode is active, which
is why there is no theme picker in the UI.

The lookup table is built from `@pierre/theme`'s committed
`figma/semantic/dark.json`, so it regenerates with the variables it describes.
See [`src/shared/roleIndex.ts`](src/shared/roleIndex.ts) for the resolution
order and the collisions it has to break.

## Development

```bash
moonx diffs-highlight:dev --ignore-ci-checks  # rebuild both realms on change
moonx diffs-highlight:test
moonx diffs-highlight:typecheck
```

Figma reloads the plugin from disk each run, so a rebuild takes effect the next
time you run it — no re-import needed.

The two realms build separately because Figma requires different shapes:
`dist/code.js` is a single IIFE for the sandbox that owns the `figma` API, and
`dist/ui.html` is one document with its script and styles inlined, since the
iframe loads no external resources. Shiki lives in the UI realm; the sandbox
only applies bindings.

Carrying all 235 grammars makes `dist/ui.html` about 8 MB. That is inherent —
nothing can be fetched at runtime, so every grammar has to be in the file — and
it costs little in practice, since a grammar is only parsed into a registry when
a language is picked: the panel loads in roughly 200 ms and a first highlight
takes about 350 ms, later ones well under 100 ms. Minifying was measured at a
10% saving, not worth the unreadable output, because the bulk is grammar data
rather than code.

`test/highlight.test.ts` runs every one of those grammars through the JavaScript
regex engine, which is the check that matters here: the sandbox cannot load
WebAssembly, so a grammar that needs Oniguruma would fail in Figma with no other
warning. All 235 pass today, and the sweep is most of the suite's ~12s runtime.
