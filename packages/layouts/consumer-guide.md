# Consumer controls and persistence

How an app fits the layout to its own chrome, stores and syncs its tree, and
puts its overlays over it. The root entry needs neither the DOM nor React to
load, so a server can import it. Its cover functions use the DOM only when an
app calls them. The package is private.

## An app's own pane header

`Root` renders no header of its own. The output of `renderPane` is the content
of each pane host, so an app renders its header there, from the parts of the
layout or from its own components. A component reads the state of its pane with
`Layout.usePane(select)`, and calls the commands of the layout object:

```tsx
const layout = createLayout(tree, [edits(naryTree), stacks()]);

function PaneHeader() {
  const tabs = Layout.usePane((pane) => pane.tabs);
  const active = Layout.usePane((pane) => pane.activeTab);
  const edges = Layout.usePane((pane) => pane.edges);
  return (
    <div className="app-header" data-top={edges.top || undefined}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-pressed={tab.id === active}
          onClick={() => layout.activate(tab.id)}
        >
          {tab.id}
        </button>
      ))}
    </div>
  );
}

const renderPane = (pane: PaneNode) => (
  <>
    <PaneHeader />
    <Layout.Content>{pane.id}</Layout.Content>
  </>
);
```

The component renders again only when a value that its selectors return changes:
a change in one pane renders only the components of that pane.

To keep the roles, the keys, and the drag of the tabs of the library, render
`Layout.TabList` with the app's own tab in the `render` prop of `Layout.Tab`.
The tab list makes the pane host the tab panel of its tab:

```tsx
<Layout.Header>
  <Layout.TabList>
    {(tab) => (
      <Layout.Tab render={(props) => <AppTab {...props} pane={tab} />} />
    )}
  </Layout.TabList>
</Layout.Header>
```

An app's handler on a part runs before the part's own handler. When the app's
handler calls `preventDefault()`, the part does nothing for that event. For
example, an app asks before Delete closes a tab:

```tsx
<Layout.Tab
  onKeyDown={(event) => {
    if (event.key === 'Delete' && !confirm('Close the tab?'))
      event.preventDefault();
  }}
/>
```

`preventDefault()` in `onPointerDown` of `Layout.Tab` or `Layout.MoveHandle`
also stops the drag, so call it there only to stop the drag.

Mark a close control inside a tab with `data-layout-tab-close`, so that a press
on it does not start a drag.

An app that keeps its own tab strip, with no `Layout.TabList`, gets one
development warning from `stacks()`, and each pane host stays a region named by
the title of its pane. The library has no other API for such a strip. Before an
app keeps one, it can check what the parts give:

- The tabs pattern: the roles, the link of each tab to its panel, the roving tab
  stop, and the keys (the arrows, Home, End, Delete, and Ctrl+Shift with PageUp
  or PageDown). `activation="manual"` on `Layout.TabList` keeps the focus on the
  tabs when a tab's content takes the focus as it shows, such as a terminal.
- Fixed tabs: `pinned: true` and `closable: false` on pane nodes, in the tree
  and in the server's fold, and `stickyPinned` on `Layout.TabList` to keep the
  pinned tabs in view while the others scroll.
- Drag: `tabDrag()` with `canDrop` for the app's drop rules, a still press for a
  touch drag so that a swipe scrolls the tab list, and a drag image, or the
  app's own element with `preview`.
- The app's own markup for each tab, in the `render` prop of `Layout.Tab`, and
  the app's own handlers on the parts. A handler that calls `preventDefault()`
  stops the part's handler for that event.

## Pane host attributes

Each pane host has `data-layout-pane` with the ID of its pane, and
`data-layout-edges`, a space-separated list of `top`, `right`, `bottom`, and
`left`: the edges of the layout that the pane touches. `Layout.usePane` gives
the same `edges`, and `computeCSSLayout` returns the same edge flags. A zoomed
pane touches every edge. The host also has `data-focused`, and, when they apply,
`data-zoomed`, `data-pane-hidden`, `data-collapsed`, `data-hidden` (under a
zoom), and `data-overlay-covered`.

Layout and zoom changes animate only with `flip()`. Without it, each change
applies at once.

## Store a tree

`layout.toStoredTree()` from `persistence()` returns `{ version: 3, root }`. It
excludes window focus and zoom. Parse untrusted data with
`parseStoredLayoutTree(value)` before passing it to
`layout.setStoredTree(tree)`. Parsing checks the core shape of the tree and
rejects unknown fields and invalid nodes with `InvalidLayoutTreeError`, which
includes the field path. The store gives the tree the shape of its model. A
saved tree that equals the current tree is no change.

## Sync with a server

The store gives each change to its listeners with its operations and its origin.
Send the local tree operations, and apply the server's tree as a remote change,
which the listener does not send back:

```ts
layout.subscribe(({ operations, origin }) => {
  if (origin !== 'local') return;
  const tree = operations.filter(isTreeOperation);
  if (tree.length > 0) send(tree);
});

applyOperations(layout, [{ type: 'setRoot', root: serverTree }]);
```

A remote `setRoot` keeps each node that equals the current one, so the server's
tree after a sync, which equals the window's tree, is no change, and an app does
not compare the trees first. On the server, `parseLayoutOperations` checks the
operations of a client and `applyLayoutOperations` folds them on the stored tree
with the same IDs. See "Operations" in the README.

## Save resize changes

`onResize(sizes)` of `Root` reports the changed split IDs and their sizes for
each local `resize` operation: a pointer release, a key press on a separator
that changes a size, or a call of `layout.setSizes`. A cancelled drag reports
nothing. The same resize reaches the store's listeners as one `resize`
operation. Storage and network writes remain the consumer's responsibility.

## Add props to separators and pane hosts

`getSeparatorProps(separator)` adds props to each separator: `className`,
`children`, `aria-label`, `hidden`, and `onDoubleClick`. `separator` is a
`LayoutSeparator`: its ID, its split, the index of the child after it, its
direction, and the panes before and after it. For example, children can give the
separator a larger hit area, and a double click can reset the split. The view
keeps the geometry, the focus, and the resize handlers. Without `aria-label`,
the label names the panes on both sides, from `messages`.

`getPaneProps(pane)` adds a `className` and `data-*` attributes to each pane
host. An app can mark its own drop targets with a data attribute:

```tsx
<Layout.Root
  layout={layout}
  renderPane={renderPane}
  getPaneProps={(pane) => ({ 'data-drop-target': pane.id })}
/>
```

The view's own attributes, such as `data-layout-pane` and `data-focused`, take
precedence. A key that pane content handles with `preventDefault()`, for example
Escape in a menu, does not cancel a gesture or restore a zoom.

## A modal over a layout

The library supplies no modal or drawer: an app uses its own, and covers the
panes under it with `coverLayout` or `Layout.useCover` (see "Overlays" in the
README). Choose the modal pattern with care. A modal `<dialog>` from
`showModal()` makes the whole document inert, and Chromium then gives each
element that renders a new style: about 300 ms to open and again to close at 16
panes of real content. This pattern avoids that cost:

- A `manual` popover (`popover="manual"`, `showPopover()`) with `role="dialog"`
  and `aria-modal="true"`, in the top layer.
- A focus trap: the focus moves into the modal when it opens, Tab and Shift+Tab
  wrap inside it, and a focus that leaves it comes back. Escape closes it, and
  the focus returns to the element that opened it.
- `aria-hidden="true"` on the page outside the modal: on each sibling of the
  modal and of each of its ancestors. Chromium keeps the page in its
  accessibility tree for `aria-modal` alone. `aria-hidden` gives no element a
  new style, unless a style rule of the app selects it.
- A shield that takes the pointer: an empty `manual` popover in the top layer
  under the modal, which also carries the backdrop color. The `::backdrop` of a
  popover lets the pointer through.
- `coverLayout(layout, modal)` when it opens, and its release when its close
  starts, so that the panes under the modal stop rendering.

Unlike `inert`, `aria-hidden` leaves the panes open to a script's `focus()`,
which the trap moves back, and to the browser's find in page. The reference
modal and drawer of the demo, in `demo/overlays`, follow this pattern, and the
`/app` demo shows them ("Review changes" and "Activity").
