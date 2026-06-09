# @pierre/theming

The theming toolkit for Pierre's open-source UI packages. It provides catalog
primitives, the loader/cache for resolving theme JSON, a normalizer plus color
transforms that resolve and derive accessible UI colors from a resolved shiki
theme, and a framework-agnostic controller for the selected color mode and
theme. `@pierre/diffs`, `@pierre/trees`, and the apps built on top of them all
draw their colors from this one package, so a single theme resolves to the same
surfaces everywhere.

It understands the [Shiki](https://shiki.style/) / VS Code theme format, so
themes shipped by Shiki, custom VS Code themes, and Pierre's first-party themes
all resolve to the same shape.

## Theme model

Theme-kit uses a few names for related but different things:

- **theme name**: the stable string apps pass around, such as `pierre-dark` or
  `github-light`. It is the id used by catalogs, resolvers, controllers,
  storage, and theme pickers. Treat it like a database key: small, serializable,
  and safe to persist.
- **theme descriptor**: the catalog entry for one name. It contains the name,
  optional metadata (`displayName`, `collection`, `colorScheme`), and a lazy
  `load()` function. Descriptors let an app list available themes without
  loading theme JSON yet.
- **resolved theme object**: the actual theme returned by a descriptor loader or
  resolver. This is the Shiki / VS Code-like object that has `colors`, `fg`,
  `bg`, `type`, and `name` after normalization.

Recommendation for apps: keep the theme name in state and storage, use
descriptors for menus and metadata, and use the resolved theme object only when
you need to color UI or hand a theme to Shiki.

### Shiki theme shape

A Shiki / VS Code theme has two important color areas:

- `tokenColors` / `settings` describe syntax highlighting rules: comments,
  strings, keywords, functions, and other code tokens.
- `colors` is a map of workbench-style UI keys, such as `editor.background`,
  `editor.foreground`, `sideBar.background`, `list.hoverBackground`,
  `focusBorder`, and `gitDecoration.addedResourceForeground`.

`normalizeThemeColors` and the color transforms read the workbench-like `colors`
keys plus the normalized top-level `fg`, `bg`, and `type`. They do not inspect
syntax-token rules. Use the raw resolved Shiki theme when rendering highlighted
code; use `normalizeThemeColors` (and the transforms) when coloring app UI
around that code.

## Entry points

theming ships one implementation through four public entry points.

| Import                   | Peer dep                                    | Purpose                                                            |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------ |
| `@pierre/theming`        | —                                           | Catalog/resolver/controller primitives and types                   |
| `@pierre/theming/color`  | —                                           | `normalizeThemeColors` plus the `colorUtils` color transforms      |
| `@pierre/theming/react`  | `react`                                     | hooks over a controller                                            |
| `@pierre/theming/themes` | `@pierre/theme`, `@shikijs/themes`, `shiki` | Bundled Pierre/Shiki collections and Shiki / VS Code normalization |

## Install

```bash
bun add @pierre/theming
```

Add the optional peers only for the entries you use, e.g., `react` for `/react`,
and `@pierre/theme`, `@shikijs/themes`, and `shiki` for `/themes`.

## Collections and catalogs

The core entry exports two closely-related composition primitives:

- A `ThemeCollection` is an ordered set of theme descriptors and lazy loaders.
  The `/themes` entry exports `themes`, the bundled Pierre-then-Shiki
  collection, plus `pierreThemes` and `shikiThemes` source collections when an
  app wants one source or wants to compose its own order.
- A `ThemeCatalog` is the app-level collection, plus `defaultLightThemeName` and
  `defaultDarkThemeName`.

Listing a name never loads, imports, or evaluates that theme. Each descriptor
only carries a loader function, so it is safe to render a full theme picker on a
page that never resolves a theme.

```ts
import { createThemeCatalog } from '@pierre/theming';
import { themes } from '@pierre/theming/themes';

const catalog = createThemeCatalog({
  themes,
  defaultLightThemeName: 'pierre-light',
  defaultDarkThemeName: 'pierre-dark',
});

catalog.getThemeNames(); // ['pierre-light', 'pierre-light-soft', …]
catalog.getThemeNames({ colorScheme: 'light' }); // ['pierre-light', …]
catalog.getThemeNames({ colorScheme: 'dark' }); // ['pierre-dark', …]
catalog.getThemes({ collection: 'pierre' }); // Pierre descriptors only
catalog.defaultLightThemeName; // 'pierre-light'
catalog.defaultDarkThemeName; // 'pierre-dark'

const opinionatedCatalog = createThemeCatalog({
  themes: themes.pick(['github-light', 'solarized-dark']),
  defaultLightThemeName: 'github-light',
  defaultDarkThemeName: 'solarized-dark',
});
```

Apps that want a local default different from theming's canonical Pierre pair
should set it on their catalog, then let the controller read those defaults:

```ts
const diffshubCatalog = createThemeCatalog({
  themes,
  defaultLightThemeName: 'pierre-light-soft',
  defaultDarkThemeName: 'pierre-dark-soft',
});

const controller = createThemeController({
  catalog: diffshubCatalog,
  defaultMode: 'system',
});
```

Collections can be passed anywhere descriptors can be passed, so larger
collections are just wrappers around smaller collections:

```ts
import { createThemeCollection } from '@pierre/theming';
import { pierreThemes, shikiThemes, createTheme } from '@pierre/theming/themes';

const appThemes = createThemeCollection({
  themes: [
    pierreThemes.pick(['pierre-light', 'pierre-dark']),
    shikiThemes.pick(['github-light', 'solarized-dark']),
    createTheme({
      name: 'acme-dark',
      collection: 'acme',
      colorScheme: 'dark',
      load: () => import('./acme-dark.json'),
    }),
  ],
});
```

Collections are immutable snapshots: their descriptor lists do not change after
construction, and helpers such as `pick()` and `orderBy()` return new
collections. Order is part of that contract:

- `themes` is bundled in a stable default order: all Pierre themes first, then
  Shiki themes.
- `getThemeNames(options)` and `getThemes(options)` preserve the current
  collection order after filtering by `colorScheme` and/or `collection`.
- `pick([...])` returns the requested themes in the caller-provided order.
- `orderBy(compare)` returns a reordered collection without loading any theme.

```ts
// Reverse alphabetical selector order.
const reverseAlphabetical = themes.orderBy((a, b) =>
  b.name.localeCompare(a.name)
);

// Pierre first, then all non-Pierre themes alphabetically by display label/name.
const collectionRank = (collection: string | undefined) =>
  collection === 'pierre' ? 0 : 1;
const pierreFirst = themes.orderBy((a, b) => {
  const rank = collectionRank(a.collection) - collectionRank(b.collection);
  if (rank !== 0) return rank;
  const aLabel = a.displayName ?? a.name;
  const bLabel = b.displayName ?? b.name;
  return aLabel.localeCompare(bLabel);
});
```

Pass plain descriptors for custom loaders that already return a usable
`ThemeLike`. Use `createTheme()` from `/themes` when the loader returns a raw VS
Code/Shiki theme that should be normalized before consumers use it:

```ts
import { createTheme } from '@pierre/theming/themes';

const acmeDark = createTheme({
  name: 'acme-dark',
  colorScheme: 'dark',
  collection: 'acme',
  displayName: 'Acme Dark',
  load: () => import('./acme-dark.json'),
});
```

Descriptor names should match the resolved theme object's machine name. The
optional `collection` field identifies the source collection for filtering and
ordering; the convention is lowercase names such as `pierre`, `shiki`, or an
app/package slug.

Normalization intentionally lives behind the public `/themes` helper, not in
`createThemeCollection()`. Collections are dependency-light registries for
names, metadata, and loaders; they can hold already-resolved `ThemeLike`
objects, app-specific generated themes, or raw VS Code/Shiki themes. Raw VS
Code/Shiki themes should use `createTheme()`. The bundled Pierre and Shiki
collections use that same helper. If an app pre-normalizes themes at build time,
it can use plain descriptors and does not need `createTheme()`.

## Resolving themes

A `ThemeResolver` is a registry of named loaders plus a cache. You register a
loader for a name; the resolver runs it at most once, dedupes concurrent calls,
and serves the resolved theme synchronously thereafter. The resolver itself
knows nothing about Shiki or theme JSON — it just caches whatever a loader
returns.

```ts
import { createThemeResolver } from '@pierre/theming';

// An isolated instance with its own registry and cache.
const resolver = createThemeResolver();
```

A loader is a zero-argument async factory that returns a theme object or a
`{ default }` ES-module namespace (the shape a dynamic `import()` of a JSON or
`.mjs` theme produces — the resolver unwraps `default`):

```ts
resolver.registerTheme('my-theme', () => import('./my-theme.json'));

// Async cold path — runs the loader, caches the result, dedupes concurrent calls.
const theme = await resolver.resolveTheme('my-theme');

// Sync warm path — returns the cached theme or undefined if not resolved yet.
const cached = resolver.getResolvedTheme('my-theme');

// "Get hot, resolve cold" — the cached theme synchronously, or a Promise.
const value = resolver.getResolvedOrResolveTheme('my-theme');
```

Other methods worth knowing:

- `registerThemeIfAbsent(name, loader)` — register only when the name is free;
  returns whether it was added. `registerTheme` throws `DuplicateThemeError`.
- `resolveThemes(names)` / `getResolvedThemes(names)` — batch variants
  (`getResolvedThemes` throws `UnresolvedThemeError` for the first cold name).
- `seedResolvedTheme(name, theme)` / `seedResolvedThemes(entries)` — drop a
  fully-resolved theme straight into the cache without a loader, for
  environments (e.g. a worker handed pre-resolved themes by the main thread)
  that can't run one.
- `hasRegisteredTheme` / `hasResolvedTheme` / `hasResolvedThemes` — registry and
  cache introspection.
- `clearResolvedThemes()` — clear the cache and in-flight loads while keeping
  the registered loaders.

`resolveTheme` rejects with `UnregisteredThemeError` when no loader exists for
the name.

### Registering theme loaders

Collections register themselves into a resolver with the per-name lazy imports.
Many themes can be registered without generating a large initial bundle to load.

```ts
import { createTheme, themes } from '@pierre/theming/themes';

// Register exactly the themes an opinionated app exposes.
themes.pick(['github-light', 'solarized-dark']).registerInto(resolver);

// Or register the full bundled Pierre-then-Shiki collection.
themes.registerInto(resolver);

// Custom VS Code/Shiki themes use the same descriptor model.
const acmeDark = createTheme({
  name: 'my-vscode-theme',
  colorScheme: 'dark',
  load: () => import('./theme.json'),
});

resolver.registerTheme(acmeDark.name, acmeDark.load);
```

Use `collection.registerInto(resolver)` when you want idempotent registration:
it calls `registerThemeIfAbsent`, so existing resolver entries win. Use
`resolver.registerTheme(descriptor.name, descriptor.load)` when duplicate names
should be an error.

Registering a whole app catalog against a resolver is also a single call. Most
apps can let `createThemeController({ catalog })` do this automatically; use
manual registration when lower-level code owns the resolver directly.

```ts
import { createThemeCatalog, createThemeResolver } from '@pierre/theming';
import { themes } from '@pierre/theming/themes';

const catalog = createThemeCatalog({
  themes,
  defaultLightThemeName: 'pierre-light',
  defaultDarkThemeName: 'pierre-dark',
});

const resolver = createThemeResolver();
catalog.registerInto(resolver);
```

## Reading theme colors

Once you have a resolved theme object, the `@pierre/theming/color` entry gives
you two things for working with its colors: `normalizeThemeColors` to read the
colors a theme actually defines, and a `colorUtils` bag of color transforms to
derive new colors from them. They live in their own entry so apps that only need
the catalog/controller don't pay for the color math.

Both exist because a raw Shiki theme is not a UI component API. Each theme may
use different workbench keys, omit optional keys, or ship a value that works in
the editor but not in a tree, popover, or app shell. Rather than make every
consumer rediscover the same fallback chains and repairs, theming centralizes
them in `normalizeThemeColors` and ships the contrast/color math as standalone
transforms.

`normalizeThemeColors` and the transforms accept a `ThemeLike` — a structural
subset of a Shiki / VS Code theme, so resolved themes from this package,
`@pierre/diffs`, or Shiki all fit:

```ts
interface ThemeLike {
  bg?: string;
  colors?: Record<string, string>;
  fg?: string;
  name?: string;
  type?: 'dark' | 'light';
}
```

### `normalizeThemeColors`

`normalizeThemeColors(theme: ThemeLike): ThemeLike` is the front door for
reading the colors a theme defines. It takes a Shiki-normalized theme (fg, bg,
and type already present) and returns a **same-shape** theme — the same
top-level fields and the same `colors` map vocabulary (the VS Code / Shiki
workbench keys, nothing renamed) — with the `colors` map resolved.

What it **fills** (mechanical fallback, no opinion):

- surfaces: `editor.background` / `editor.foreground`, `sideBar.background` /
  `sideBar.foreground`, `input.background`, `sideBarSectionHeader.foreground`,
  and `list.activeSelectionForeground`.
- git status: `gitDecoration.{added,modified,deleted}ResourceForeground` via the
  `gitDecoration → terminal.ansi* → editorGutter.*` chain.
- the focus ring: `list.focusOutline`, set to the first non-transparent of
  `list.focusOutline` then `focusBorder`.

What it **repairs** (universal correctness): it drops `list.hoverBackground`
when it equals the sidebar surface or would erase the row text.

What it deliberately **leaves alone** (consumer opinion): the selection lookup
(`list.activeSelectionBackground` / `list.focusBackground` /
`editor.selectionBackground`) passes through raw, so each consumer applies its
own choice.

The result is pure, frozen, WeakMap-memoized per input theme, and idempotent. It
runs lazily at read time by default.

```ts
import { normalizeThemeColors } from '@pierre/theming/color';

const { colors } = normalizeThemeColors(theme);
// colors['sideBar.background'], colors['gitDecoration.addedResourceForeground'],
// colors['list.focusOutline'], …
```

### Color transforms

`colorUtils` bundles the pure color transforms — functions with no theme
knowledge that take colors and answer questions about them or mix new ones.
Bundling them in one object keeps the entry's export surface small. Use them to
derive **new** colors from a theme's colors. Its methods:

- `relativeLuminance`, `contrastRatio` — WCAG luminance and contrast math.
- `isDarkSurface`, `surfacesMatch`, `isFullyTransparent` — surface predicates.
- `compositeOverBg` — flatten a translucent color over a background.
- `hoverWouldEraseText` — whether a hover color would erase row text.
- `pickReadableForeground` — the most legible foreground for a surface.
- `deriveMutedFg` — a muted foreground derived from fg and surface.

```ts
import { colorUtils, normalizeThemeColors } from '@pierre/theming/color';

const { colors } = normalizeThemeColors(theme);
const surface = colors['sideBar.background'];
const fg = colorUtils.pickReadableForeground(surface, [
  colors['sideBar.foreground'],
]);
const mutedFg = colorUtils.deriveMutedFg(fg, surface);
```

### `normalizeTheme` (Shiki) vs `normalizeThemeColors` (theming)

These are two different normalizers; do not wire them up backwards.

- Shiki's `normalizeTheme` (from `shiki/core`, applied at load by `createTheme`)
  normalizes the **whole** theme, including syntax token colors and the base
  `fg` / `bg` / `type`.
- theming's `normalizeThemeColors` only resolves the workbench `colors` map and
  **assumes** a theme that has already been Shiki-normalized.

So `normalizeTheme` runs first, at load; `normalizeThemeColors` runs after, on
the already-normalized theme.

### Assembled token sets are consumer-owned

theming ships no assembled token object. The opinionated, presentation-ready
token sets live with their consumers:

- `@pierre/trees`' `themeToTreeStyles()` builds its tree CSS variables on
  `normalizeThemeColors`.
- Apps build their own app-chrome tokens from `normalizeThemeColors` plus the
  transforms — for example diffshub's `deriveChromeTokens`.

Each consumer maps the resolved/derived colors onto its own variable names, so
the mapping lives in one place per consumer and the color resolution lives here,
shared.

### Read-time vs pre-warm at load

Normalization runs lazily at read time and is memoized, so the default needs no
wiring: the first read of a theme normalizes it, and every later read returns
the same frozen object.

Because `normalizeThemeColors` is pure and idempotent, an app that wants a
pre-densified canonical object at load can call `normalizeThemeColors` inside
its loader and `seedResolvedTheme` the result. That captures the load-time
benefit for anyone who wants it without mandating a chokepoint that would break
the resolver's contract or miss runtime-registered themes. The default is
lazy/read-time; pre-warming is a one-line opt-in.

## The theme controller

The controller is the stateful layer: it owns the selected light and dark theme
names, the color mode (`'light' | 'dark' | 'system'`), the theme resolved for
the active mode, and persistence. It has no React dependency, so a vanilla app
can drive it directly; the `/react` hooks are thin wrappers over it.

It is **SSR-safe**: every browser access (`localStorage`, `matchMedia`) is
guarded, so it constructs and runs on the server (persistence and the
prefers-color-scheme listener no-op) and hydrates on the client.

```ts
import { createThemeCatalog } from '@pierre/theming';
import { createThemeController } from '@pierre/theming';
import { themes } from '@pierre/theming/themes';

const catalog = createThemeCatalog({
  themes,
  defaultLightThemeName: 'pierre-light',
  defaultDarkThemeName: 'pierre-dark',
});

const controller = createThemeController({
  catalog,
  defaultMode: 'system',
  storageKey: 'theme', // built-in localStorage persistence (one JSON entry)
});

controller.getState();
// {
//   mode: 'system',
//   lightThemeName: 'pierre-light',
//   darkThemeName: 'pierre-dark',
//   resolvedTheme: ThemeLike | undefined,  // the active theme, once resolved
//   resolvedColorScheme: 'light' | 'dark', // 'system' collapsed to a concrete scheme
// }

controller.resolver; // the resolver this controller created and registered into

controller.setColorMode('dark');
controller.setThemeNameForScheme('light', 'catppuccin-latte');

const unsubscribe = controller.subscribe(() => render(controller.getState()));
controller.destroy(); // detach the prefers-color-scheme listener
```

`resolvedColorScheme` is the concrete `'light' | 'dark'` after resolving
`'system'` against the OS preference — drive your `data-theme` / `class`
application off it directly rather than re-deriving it. While in `'system'` mode
the controller listens for OS theme flips and re-resolves automatically. Only
the active theme is resolved by default; pass `preloadInactive: true` to resolve
the inactive one too so a mode flip is instant.

### Resolver ownership

`createThemeController({ catalog })` creates an isolated resolver, registers the
catalog into it, and exposes it as `controller.resolver`. That is the
recommended path for most apps: the controller/provider becomes the single owner
of theme selection and resolution.

Pass `resolver` explicitly when several controllers, vanilla widgets, workers,
or tests intentionally need to share one registry/cache:

```ts
import { createThemeResolver } from '@pierre/theming';

const resolver = createThemeResolver();
const controller = createThemeController({ catalog, resolver });

controller.resolver === resolver; // true
```

Use multiple resolvers only for deliberate isolation: embedded widgets,
tenant-specific registries, SSR request isolation, tests, or side-by-side
previews where the same theme name should resolve to different objects.
Otherwise, share one resolver to avoid a split-cache bug where one part of an
app registers a loader that another part cannot see.

### Persistence

By default, pass a `storageKey` to get built-in `localStorage` persistence under
one JSON entry. Omit it to disable persistence. For a custom layout — for
example mapping the selection onto pre-existing keys, or a non-`localStorage`
store — pass a `persistence` adapter, which takes precedence over `storageKey`:

```ts
import type { ThemePersistence } from '@pierre/theming';

const persistence: ThemePersistence = {
  load() {
    /* return a { mode, lightThemeName, darkThemeName } selection, or null */
  },
  save(selection) {
    /* persist it; guard your own browser access to stay SSR-safe */
  },
};

createThemeController({ catalog, persistence });
```

Only the selection (`mode` + the two theme names) is ever persisted — the
resolved theme object is always re-derived from the resolver on load.

## React bindings

The `/react` entry is a `useSyncExternalStore` selector over a controller
instance — no state of its own, no tearing, SSR-friendly. Create the controller
once (a module singleton is fine) and pass it in. `useThemeController` returns
the full controller state, including `resolvedTheme`.

```tsx
import { useThemeController } from '@pierre/theming/react';

function ThemeToolbar() {
  const { mode, resolvedColorScheme } = useThemeController(controller);

  return (
    <button
      onClick={() =>
        controller.setColorMode(mode === 'dark' ? 'light' : 'dark')
      }
    >
      {resolvedColorScheme}
    </button>
  );
}
```

## Putting it together

A typical app wires the pieces in this order:

1. **Create one catalog** from the theme collections the app exposes. Use
   `themes.pick([...])` when the app only offers a small opinionated set.
2. **Create one controller** as a module singleton with that catalog and your
   persistence. Use `controller.resolver` anywhere lower-level code needs the
   same registry/cache.
3. **Subscribe** (via the `/react` hooks or `controller.subscribe`) and apply
   `resolvedColorScheme` to the document (`data-theme`, `class`,
   `style.colorScheme`).
4. **Theme your chrome** by building your own chrome tokens from
   `normalizeThemeColors(resolvedTheme)` plus the color transforms (as diffshub
   does) and mapping them onto your CSS variables, and **theme nested file
   trees** by handing the resolved theme to `@pierre/trees`'
   `themeToTreeStyles()` (which sits on `normalizeThemeColors`).

Theme-kit currently stops at these engine-level primitives. Higher-level
component-wrapper prop contracts, such as a single `theme` prop shared across
diff, tree, and chrome components, are still app-local while that API settles.
