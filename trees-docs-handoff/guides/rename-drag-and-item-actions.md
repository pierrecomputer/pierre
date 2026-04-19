# Rename, drag, and trigger item actions

## Purpose

- Teach the primary row-level editing workflows: rename first, drag and drop
  second, context menus third.
- Keep the page focused on user-facing item actions, not on generic mutation
  inventories or sync recipes.
- Reinforce path-first identity for every action callback and command surface.

## Audience and entry point

- Readers already render a tree in React or vanilla.
- They want rows to do more than navigate: rename items, move them, and expose
  extra commands.
- This page should explain one workflow family, then point to runtime/reference
  details where the APIs differ.

## Start with direct row actions

- Lead with the interactions users notice on the row itself:
  1. rename in place
  2. drag and drop
  3. optional context menu commands
- State the shared rule early: these workflows report canonical paths, not row
  indexes.
- Keep generic programmatic mutations in shared/reference docs instead of
  teaching them here.

## Rename items in place

- Introduce renaming as the first built-in editing behavior.
- Explain the user flow in concrete terms:
  - focus a row
  - trigger rename from the keyboard or command surface
  - confirm or cancel inline
- Cover the common policy hooks:
  - `canRename` to block protected paths or item kinds
  - `onRename` to react to the path change
  - `onError` to surface invalid rename attempts
- Clarify the event shape at the guide level: source path, destination path, and
  whether the renamed item is a folder.
- Example notes:
  - React: enable `renaming` in `useFileTree(...)` and keep surrounding UI
    feedback in component state when needed
  - Vanilla: pass `renaming` to `new FileTree(...)` and update adjacent UI from
    callbacks

## Move items with drag and drop

- Introduce drag and drop after rename, not before it.
- Explain the common user story:
  - drag files or folders onto a destination folder or root
  - hovering can open folders before drop
  - filtered/search-heavy views can change what drag targets are visible, so the
    guide should not overpromise pointer workflows while search is active
- Cover only the practical customization points:
  - `canDrag` to lock specific paths
  - `canDrop` to reject invalid destinations
  - `onDropComplete` for persistence or follow-up UI
  - `onDropError` for visible failures
- Clarify that drop callbacks report dragged paths plus the resolved target
  shape.
- Example notes:
  - React: configure `dragAndDrop` in `useFileTree(...)` and update adjacent UI
    from callbacks
  - Vanilla: pass the same `dragAndDrop` config to `new FileTree(...)` and use
    the same callback model

## Combine rename and drag safely

- Show the common editable project-tree setup:
  - `renaming` enabled
  - `dragAndDrop` enabled
  - policy guards for protected files or folders
- Good examples to call out:
  - lock root config files such as `package.json`
  - forbid drops into generated/output directories
  - surface rename/drop errors outside the tree instead of failing silently

## Add a context menu as an optional command surface

- Introduce context menus after rename and drag/drop.
- Position the menu as an optional surface for the same workflows plus extra
  commands.
- Cover the practical choices only:
  - `composition.contextMenu.enabled` to turn the surface on
  - `triggerMode` for right-click, button, or both
  - `buttonVisibility` when rows should show an action affordance
  - `render` or React `renderContextMenu` for menu content
- Keep the accessibility point explicit: primary rename and drag flows should
  remain available without requiring the menu.
- Use the menu for secondary actions such as duplicate, reveal, copy path,
  delete, or a rename entry point.

## Keyboard and focus expectations

- Keep this section short and user-facing:
  - the focused row is the anchor for rename and keyboard-invoked commands
  - keyboard users need access to the same actions without pointer-only gestures
  - opening and closing the context menu should restore focus predictably
- Keep renderer internals out of the page.

## How this page should talk about persistence

- The tree owns the interaction surface and emits path-based events.
- The surrounding app decides whether to persist changes to a server, local
  state, or another boundary.
- Do not turn this page into a filesystem-sync or server-sync tutorial.
- Phrase the guidance as “listen for rename/drop events and apply them in your
  app.”

## Paired examples to include

- Basic rename-enabled tree in React and vanilla.
- Drag-and-drop tree with one protected path and one rejected drop target.
- Context menu that offers Rename and Delete while making clear that direct
  rename already exists.

## Cross-links

- `./navigate-selection-focus-and-search.md`
- `../reference/shared-concepts.md`
- `../reference/react-api.md`
- `../reference/vanilla-api.md`

## Scope boundaries

- On this page:
  - rename
  - drag and drop
  - context menus as an optional command surface
  - path-based callbacks and user-facing workflow choices
- Not on this page:
  - exhaustive mutation API inventory
  - filesystem/server synchronization recipes
  - renderer internals
  - controller-focused or low-level docs
