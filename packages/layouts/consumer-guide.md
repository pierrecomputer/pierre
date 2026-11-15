# Consumer controls and persistence

A split-pane layout engine with tabs, resize controls, and a React view. The
root entry needs neither the DOM nor React to load, so a server can import it.
Its overlay and cover functions use the DOM only when an app calls them. The
package is private.

## Customize a header

Pass `renderHeader` to `Layout` to replace the default header. The callback
receives the pane, its stack, its visible tabs, its outer edges, and its focus,
zoom, and collapse state. It also receives `select`, `close`, and `canClose`
controls.

```tsx
<Layout
  store={store}
  loneTabStrip
  animate={false}
  renderPane={(pane) => <Document id={pane.id} />}
  renderHeader={(header) => (
    <div {...header.tablistProps}>
      {header.tabs.map((tab) => (
        <button key={tab.id} {...header.getTabProps(tab)}>
          {tab.id}
        </button>
      ))}
    </div>
  )}
/>
```

Spread `tablistProps` on the tab strip and `getTabProps(tab)` on each tab to
retain accessible roles, keyboard navigation, selection, and pointer drag. Mark
a close control inside a tab with `data-layout-tab-close` so that it does not
start a drag. A custom header owns its markup and styling. A hidden tab keeps
its content, but has no header.

`loneTabStrip` gives a pane outside a stack one tab. Without it, the default
header keeps its title. A dragged tab can join another group, reorder within a
strip, or split at a pane edge. The outer 28% of the width and 30% of the height
are edge drop zones; the center joins a group.

Pane hosts retain `data-layout-pane` and expose `data-layout-edges` as a
space-separated list of `top`, `right`, `bottom`, and `left`. `computeCSSLayout`
returns the same edge flags. A zoomed pane touches every edge. Zoom keeps
keyboard focus outside the layout when focus starts there.

`animate={false}` disables both layout and zoom animations. The existing
`{ layout: false }` and `{ zoom: false }` controls remain available. The
`/consumer.html` demo shows custom headers and resize reporting. The modal and
drawer entries remain separate.

## Store a tree

`store.toStoredTree()` returns `{ version: 3, root }`. It excludes window focus
and zoom. Parse untrusted data with `parseStoredLayoutTree(value, model)` before
passing it to `store.setStoredTree(tree)`. Parsing rejects unknown fields and
invalid nodes with `InvalidLayoutTreeError`, which includes the field path. The
default parser model is `naryTree`. The existing `serialize` and `restore`
methods still include local focus and zoom.

To keep a server's tree the same as the store's tree, send the store's
operations and fold them on the server: see "Operations" in the README, with
`parseLayoutOperations` and `applyLayoutOperations`.

## Save resize changes

`Layout.onResize(sizes)` reports changed split IDs and their sizes once after a
completed pointer drag, and after each keyboard resize that changes a size. A
cancelled drag reports nothing. Programmatic store updates do not call it.

Each completed resize also gives one `resize` operation to the store's
listeners, with the same split IDs. A server folds it with
`applyLayoutOperations`. Storage and network writes remain the consumer's
responsibility.

## Control a resize

`Layout.onResizeStart(context)` runs when a pointer resize starts and for each
keyboard resize. Only the `Layout` component has it; `Layout.Root` does not.
`context` holds the separator or corner `element`, the pixel geometry of the
`separators` that the resize changes, and its `source`: `pointer` or `keyboard`.
The callback can return a `LayoutResizeSession`:

```tsx
<Layout
  store={store}
  renderPane={renderPane}
  onResizeStart={() => {
    setResizing(true);
    return {
      update: (sizes) => snapToColumns(sizes),
      end: () => setResizing(false),
    };
  }}
/>
```

- `update(sizes, point)` returns the sizes to apply in place of the proposed
  sizes, for example sizes that snap to a position. `point` holds the pointer's
  `clientX` and `clientY`, or is null for a keyboard resize.
- `end(cancelled)` runs once when the resize ends: with `false` after the sizes
  apply, and with `true` after a cancellation or an unmount. A cancellation and
  an unmount restore the sizes from before the resize.

A pointer resize is one session from press to release. Each key press that
resizes is a session of its own. A window blur during a pointer resize applies
the current sizes and ends the session, because the pointer release may never
come. The view keeps the pointer capture and the keyboard handling: a key that
resizes does not reach key handlers above the layout. `onResize` reports the
applied sizes before `end` runs.

## Add props to separators and pane hosts

`getSeparatorProps(separator)` adds props to each separator: `className`,
`children`, `aria-label`, `hidden`, and `onDoubleClick`. `separator` is the
`CSSSeparator` of `computeCSSLayout`, with its split and the index of the child
after it. For example, children can give the separator a larger hit area, and a
double click can reset the split. The view keeps the geometry, the focus, and
the resize handlers. Without `aria-label`, the label names the panes on both
sides.

`getPaneProps(pane)` adds props to each pane host: `className`, `tabIndex`,
`aria-label`, and `data-*` attributes. An app can mark its own drop targets with
a data attribute, and leave it out on a structural host, such as the host of a
sidebar, which also needs no tab stop:

```tsx
<Layout
  store={store}
  renderPane={renderPane}
  getPaneProps={(pane) =>
    pane.id === 'sidebar' ? { tabIndex: -1 } : { 'data-drop-target': pane.id }
  }
/>
```

The view's own attributes, such as `data-layout-pane` and `data-focused`, take
precedence. A hidden host is never a tab stop. `aria-label` names a host without
tabs; a host with tabs takes its name from its tab.

A key that pane content handles with `preventDefault()`, for example Escape in a
menu, does not cancel a gesture or restore a zoom.
