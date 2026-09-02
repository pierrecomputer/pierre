# @pierre/trees API audit callouts

This file is the secondary, more opinionated output. It lists places that may
deserve human review before the first major release. These are not fixes and not
all are necessarily bugs.

## 1. Export map is smaller than generated type surface

**Observed:** `package.json` exports only `.`, `./react`, `./ssr`, and
`./web-components`, but the build emits declarations and JavaScript for many
`dist/**` source modules. `typesVersions` maps `*` to `dist/*`.

**Why audit it:** Users and agents may discover deep files in published output
even though the runtime export map does not expose them. That can blur what is
public. It also makes types such as `SVGSpriteNames`, `BuiltInFileIconToken`,
and several internal model/render types visible in generated files without being
root exports.

**External surface involved:** package metadata, TypeScript editor behavior,
published tarball shape.

**Question:** Is the intended public contract only the export map, or are some
deep imports/types meant to be supported?

## 2. Root entry point also exports SSR helpers

**Observed:** `preloadFileTree`, `serializeFileTreeSsrPayload`, and
`FileTreeSsrPayload` are exported from both `@pierre/trees` and
`@pierre/trees/ssr`.

**Why audit it:** Docs position `@pierre/trees/ssr` as the SSR import path, but
root imports also work. That is convenient, but it makes the SSR boundary less
clear and increases the root API surface.

**External surface involved:** root exports, SSR docs, bundling expectations.

**Question:** Should SSR remain available from root as a convenience, or should
the docs bless only one path while accepting the other as legacy/convenience?

## 3. `FileTreeOptions` is broad and mixes model, rendering, composition, styling, and behavior

**Observed:** One options object includes input (`paths`, `preparedInput`),
model behavior (`initialExpansion`, `initialSelectedPaths`,
`fileTreeSearchMode`), mutation feature flags (`dragAndDrop`, `renaming`),
render behavior (`initialVisibleRowCount`, `overscan`, `stickyFolders`),
composition (`header`, `contextMenu`), styling (`density`, `itemHeight`,
`unsafeCSS`), icons, Git status, and callbacks.

**Why audit it:** The single object is easy to start with, but it hides which
settings are construction-only, which can be updated with model methods, and
which affect SSR/hydration shape. React examples have to teach that
`useFileTree(options)` only reads the object once.

**External surface involved:** `FileTreeOptions`, React `useFileTree`, SSR
hydration, docs tables.

**Question:** Are construction-only and runtime-updatable options obvious enough
for v1 users?

## 4. Some public options are under-documented compared with examples/source

**Observed:** Source exposes options such as `presorted`, `stickyFolders`,
`searchBlurBehavior`, and `searchFakeFocus`. Docs and guides emphasize many core
options but do not give all of these equal reference-level treatment.
`searchFakeFocus` is explicitly described in source comments as demo/marketing
oriented.

**Why audit it:** Any option in `FileTreeOptions` becomes part of the v1
contract. Under-documented options are easy to misuse and hard to remove later.

**External surface involved:** `FileTreeOptions`, reference docs, demos.

**Question:** Which of these are intentional public API, and which are escape
hatches that should be renamed, moved, or documented as advanced?

## 5. Boolean-or-config options trade convenience for ambiguity

**Observed:** `dragAndDrop` and `renaming` accept `boolean | config`. `search`
is a boolean, but it controls only the built-in search UI, not the existence of
the search model/session.

**Why audit it:** Boolean enablement is concise, but it makes behavior less
self-describing at call sites. `renaming: true` means inline rename is enabled
without persistence callbacks. `dragAndDrop: true` enables default mutation
behavior. `search: false` can still coexist with programmatic search.

**External surface involved:** `FileTreeOptions`, docs examples, app wrappers.

**Question:** Are the boolean forms desirable long-term, or do they obscure too
much policy for a v1 API?

## 6. Search API has multiple concepts under similar names

**Observed:** Search has:

- `search: boolean` for built-in input rendering
- `fileTreeSearchMode` for match projection behavior
- `initialSearchQuery`
- `onSearchChange`
- `searchBlurBehavior`
- `searchFakeFocus`
- model methods such as `setSearch`, `openSearch`, `closeSearch`,
  `isSearchOpen`, `getSearchValue`, and match navigation
- React `useFileTreeSearch`

**Why audit it:** Users may reasonably assume `search: false` disables search,
but examples show programmatic search still works. Some demos hide the built-in
search UI with `unsafeCSS` while still constructing the model with
`search: true` to keep SSR/client markup aligned.

**External surface involved:** search options, search hooks, SSR demos, styling
escape hatch.

**Question:** Should the public names distinguish "render the built-in input"
from "enable search session state" more explicitly?

## 7. Directory path identity is not represented one way everywhere

**Observed:** Examples and tests use bare directory paths such as `src` in
`initialExpandedPaths` and `getItem('src')`. Internal canonical directory
handles can return slash-suffixed paths such as `src/`. Rename policy/events
strip trailing slashes for folders, then re-add them internally for moves. Git
status examples use a trailing slash for directory statuses.

**Why audit it:** Paths are the primary external identity token. If the API
accepts both `src` and `src/` but sometimes emits one form, users must learn
where normalization happens and where it does not.

**External surface involved:** expansion, selection, focus, item handles, Git
status, rename, drag/drop, mutations.

**Question:** What is the v1 story for canonical public paths, especially for
directories?

## 8. `paths` plus `preparedInput` is powerful but surprising

**Observed:** Options and `resetPaths` can carry both raw `paths` and
`preparedInput`; source validates that the lists match and throws when they
differ. Docs call prepared input opaque, but the prepared value exposes
`readonly paths` and examples sometimes pass both values together.

**Why audit it:** Users can wonder why both are needed, which one wins, and
whether `preparedInput.paths` is safe to read. Mismatch errors are helpful, but
the API shape still communicates two sources of truth.

**External surface involved:** `prepareFileTreeInput`,
`preparePresortedFileTreeInput`, `FileTreeOptions`, `resetPaths`.

**Question:** Should v1 docs define a clear rule for when to pass only prepared
input versus both raw and prepared paths?

## 9. Context menu enablement is not only `enabled: true`

**Observed:** Source enables the context menu if `enabled === true`, `render`
exists, `onOpen` exists, or `onClose` exists. When enabled and `triggerMode` is
omitted, it defaults to right-click. `buttonVisibility` matters only for
button-capable trigger modes.

**Why audit it:** A caller may read `enabled?: boolean` as the gate, but
callbacks or render functions also imply enablement. This is convenient but
makes `enabled: false` plus callbacks an ambiguous configuration.

**External surface involved:** `FileTreeCompositionOptions`, React
`renderContextMenu`, demos.

**Question:** Should `enabled` be an explicit gate, or should the current
"presence implies enablement" behavior be documented as the contract?

## 10. Header and context menu can be configured in multiple places

**Observed:** Vanilla callers can set `composition.header.html`,
`composition.header.render`, and `composition.contextMenu.render`. React callers
can also pass `header` and `renderContextMenu` props. The React component
removes model header/render pieces when the corresponding React prop is present,
while preserving/wrapping context-menu callbacks.

**Why audit it:** Multiple configuration locations can be ergonomic, but
precedence rules become part of the API. A user may expect model composition and
React props to compose rather than override.

**External surface involved:** React `FileTreeProps`,
`FileTreeCompositionOptions`, SSR hydration.

**Question:** Are precedence and ownership rules for React composition clear
enough in docs and types?

## 11. Docs compatibility wrappers expose older or alternate API names

**Observed:** `apps/docs/lib/treesCompat*.ts(x)` exposes wrapper props such as
`files`, `initialFiles`, `initialExpandedItems`, `initialSelectedItems`,
`selectedItems`, `onFilesChange`, `onSelection`, `prerenderedHTML`, and
`options.virtualize`. The docs `Overview` page uses this wrapper rather than
direct package imports.

**Why audit it:** These are not package exports, but they appear in repo
examples and can teach agents or maintainers the wrong vocabulary. They also
preserve old concepts such as item-based naming while the package API is
path-based.

**External surface involved:** docs examples, internal docs app API, user-facing
documentation snippets.

**Question:** Should public docs avoid wrappers that do not match the package
API, or clearly label them as docs-only scaffolding?

## 12. Styling API spans CSS variables, theme helper, density options, data attributes, and `unsafeCSS`

**Observed:** Styling can be done through host CSS variables,
`themeToTreeStyles`, `density`, `itemHeight`, normal host `style`, and
`unsafeCSS`. Docs also show selectors into shadow DOM internals.

**Why audit it:** Shadow DOM encapsulation usually narrows styling contracts.
`unsafeCSS` intentionally pierces that boundary, which can make internal data
attributes and selectors de facto public. The broader the styling surface, the
harder it is to refactor DOM structure after v1.

**External surface involved:** CSS variables, `themeToTreeStyles`, `unsafeCSS`,
data attributes, docs styling guide.

**Question:** Which selectors and data attributes are intended public styling
hooks, and which should remain undocumented internals?

## 13. A styling guide selector appears not to match the current DOM

**Observed:** The docs styling guide contains
`button[data-item-button][data-item-focused="true"]`. Source-rendered item
buttons use `button[data-type="item"]` and `data-item-focused`;
`data-item-button` was not observed in source.

**Why audit it:** This is likely a docs/API drift issue. Even if `unsafeCSS` is
an escape hatch, examples teach users which shadow DOM selectors are stable
enough to copy.

**External surface involved:** `unsafeCSS`, styling guide, shadow DOM row
markup.

**Question:** Is `data-item-button` an intended public attribute that source
lost, or should docs use the current selector?

## 14. Icon helper types are more stringly at root than internally

**Observed:** Root exports `getBuiltInFileIconColor(token: string)` but not the
internal `BuiltInFileIconToken` union. `createFileTreeIconResolver` returns
values involving `SVGSpriteNames`, but that type is not root-exported. Remap
maps are `Record<string, RemappedIcon>`.

**Why audit it:** Users writing icon tooling get less type guidance than the
package appears to have internally. That may be acceptable for flexibility, but
it makes typo detection weaker in public code.

**External surface involved:** icon config, helper functions, root type exports.

**Question:** Are built-in icon names meant to be strongly typed for consumers?

## 15. `getBuiltInSpriteSheet('none')` returns a minimal sheet

**Observed:** Source maps `set === 'none'` to the minimal built-in sprite sheet
for `getBuiltInSpriteSheet`.

**Why audit it:** The word `none` can imply no built-in SVG at all. Returning
the minimal symbols may be required because core UI icons such as chevrons or
ellipsis still need symbols, but the name can surprise users.

**External surface involved:** `FileTreeIconConfig.set`,
`getBuiltInSpriteSheet`, custom icon documentation.

**Question:** Should docs clarify that `none` means no built-in file-type
mapping, not necessarily no SVG symbols?

## 16. Event timing matters for persistence callbacks

**Observed:** Rename code calls `onRename` before committing the internal move.
Drag/drop commits model mutations and then calls `onDropComplete`. Mutation
subscribers receive semantic events for add, remove, move, reset, and batch.

**Why audit it:** Persistence integrations need to know whether callbacks are
pre-commit validation points, post-commit notifications, or both. Different
features currently expose different timing.

**External surface involved:** `FileTreeRenamingConfig`,
`FileTreeDragAndDropConfig`, `onMutation`.

**Question:** Should v1 docs describe callback timing and rollback/error
behavior feature by feature?

## 17. `presorted` and `preparePresortedFileTreeInput` overlap conceptually

**Observed:** `FileTreeOptions` includes `presorted`, while public helpers
include `preparePresortedFileTreeInput(paths)`. Demos lean on the helper,
sometimes while also passing raw paths.

**Why audit it:** There are two ways to communicate that input order is already
meaningful. One is an option flag; the other is a prepared-input constructor.
Both may be useful, but the distinction is not immediately obvious at call
sites.

**External surface involved:** input preparation, sorting, reset paths,
performance docs.

**Question:** Which one should users reach for first, and what is the other for?

## 18. SSR payload is both described as opaque and field-addressable

**Observed:** SSR docs tell users to use package helpers and treat the payload
as generated data. The exported type exposes `domOuterStart`, `outerStart`,
`shadowHtml`, `outerEnd`, and `id`. README-style examples show manual string
concatenation from fields.

**Why audit it:** Field-addressable payloads are flexible across frameworks, but
exported fields become hard to change. The docs should be clear about which
fields are stable and which helpers are preferred.

**External surface involved:** `FileTreeSsrPayload`,
`serializeFileTreeSsrPayload`, React `preloadedData`.

**Question:** Is manual payload assembly a supported v1 pattern or only an
advanced escape hatch?

## 19. Web-components entry exports low-level helpers

**Observed:** `@pierre/trees/web-components` exports
`adoptDeclarativeShadowDom`, `ensureFileTreeStyles`, and
`prepareFileTreeShadowRoot`, in addition to registering the custom element.

**Why audit it:** These helpers sound implementation-level, but the export map
makes them public. If users import them directly, future shadow-root setup
changes become breaking changes.

**External surface involved:** `@pierre/trees/web-components`, SSR/declarative
shadow DOM behavior.

**Question:** Are these helpers intended for framework authors, tests, or all
users?

## 20. Some docs/app-level comments reveal configuration coupling

**Observed:** `apps/docs/components/TreeApp.tsx` documents that `searchEnabled`
must match a model constructed with `search: true`, and rename menu actions
require the model to be constructed with `renaming: true` or config.

**Why audit it:** These couplings are real for external users too, but they are
surfaced in app wrapper comments rather than package-level reference docs.

**External surface involved:** `search`, `renaming`, context menu actions, React
wrappers.

**Question:** Should task-oriented docs explicitly call out these required
combinations?

## 21. Configuration can be dynamic only through selected methods

**Observed:** Runtime methods exist for `resetPaths`, `setComposition`,
`setGitStatus`, `setIcons`, and search/mutation operations. There are no
equivalent setters for every construction option. React demos sometimes remount
with a key when changing structural settings.

**Why audit it:** Users may expect changing React props/options to update the
tree, especially for appearance options such as density or feature toggles such
as context-menu behavior. The actual model API is method-driven.

**External surface involved:** React `useFileTree`, model methods, demos.

**Question:** Should the v1 docs include a clear "construction-only vs
runtime-updatable" table?

## 22. `unsafeCSS` is powerful enough to create hidden public contracts

**Observed:** Docs and demos use `unsafeCSS` for shadow DOM internals, including
hiding the search container and customizing item styling. Because it is injected
into the shadow root, any selector shown in docs can become sticky for users.

**Why audit it:** If users rely on internal structure through copied
`unsafeCSS`, later DOM refactors become breaking in practice even if the
TypeScript API is stable.

**External surface involved:** `unsafeCSS`, row/search DOM structure, styling
docs.

**Question:** Should `unsafeCSS` examples be limited to explicit supported
selectors, or should it be documented as fully unstable?
