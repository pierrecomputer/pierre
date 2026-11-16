'use client';

// The contract between `Root`, its features, and its parts. A feature carries
// a store part (commands), a view part (a hook that runs on each render of
// `Root`), and its sheets. A part reads its pane from the pane context and
// subscribes to the state that it shows.
import {
  type Context,
  createContext,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import type { CSSLayout, CSSPane } from '../css-layout';
import type { PaneVisibility } from '../dom/visibility';
import type { LayoutChange, LayoutOperation } from '../layout-operation';
import type { CoreLayoutStore, StoreFeature } from '../store';
import type {
  ChildSize,
  Edge,
  LayoutGeometry,
  LayoutNode,
  LayoutState,
  PaneNode,
  SeparatorGeometry,
} from '../types';

/** The sizes of splits, by split ID. */
export type Sizes = Record<string, ChildSize[]>;

/**
 * A pointer gesture: a resize, a move drag, or a tab drag. `Root` sends each
 * pointer move of the gesture's pointer to `move`, and ends it on the pointer
 * release (`end(false)`), on a cancellation, Escape, or an unmount
 * (`end(true)`).
 */
export interface Gesture {
  readonly pointerId: number;
  move(event: PointerEvent<HTMLElement>): void;
  end(cancel: boolean): void;
}

/**
 * State of the view that is not in the store, such as the pane that a drag
 * moves and the drop target. Parts subscribe to it, so a drag renders them and
 * not the pane content around them.
 */
export interface ViewState {
  get(): Readonly<Record<string, unknown>>;
  set(patch: Readonly<Record<string, unknown>>): void;
  subscribe(listener: () => void): () => void;
}

/**
 * How `Root` renders its sheets (its `stylesheets` prop): `undefined` injects
 * them, `{ nonce }` injects them with a nonce for a content security policy,
 * and `null` injects none (the app links `styles.css`).
 */
export type StylesheetsSetting = { readonly nonce?: string } | null | undefined;

/** The values of a message about one pane: its title from `getPaneTitle`, and its ID. */
export interface PaneMessageValues {
  readonly paneTitle: string;
  /** The `PaneNode.id` of the pane. */
  readonly paneId: string;
}

/** The values of a message about a pane and a target pane. */
export interface TargetMessageValues extends PaneMessageValues {
  readonly targetTitle: string;
  /** The `PaneNode.id` of the target pane. */
  readonly targetId: string;
}

/** The values of a message about a pane at an edge of a target pane. */
export interface EdgeMessageValues extends TargetMessageValues {
  readonly edge: Edge;
}

/** The values of the name of a separator: the panes that show on each side of it. */
export interface SeparatorMessageValues {
  /** The titles of the panes before the separator, joined with ", ". */
  readonly beforeTitles: string;
  /** The titles of the panes after the separator, joined with ", ". */
  readonly afterTitles: string;
  /** The number of panes before the separator. */
  readonly beforeCount: number;
  /** The number of panes after the separator. */
  readonly afterCount: number;
  /** The ID of the first pane before the separator, in reading order. */
  readonly beforeId: string;
  /** The ID of the first pane after the separator, in reading order. */
  readonly afterId: string;
}

/**
 * The strings of a layout (`DEC-layouts-messages-option`). Each function
 * returns the whole sentence, so a translation chooses its own words and word
 * order, and takes one flat object of named values, which an ICU message
 * catalog takes as it is: pane titles from `getPaneTitle` (`paneTitle`,
 * `targetTitle`), the IDs of the same panes (`paneId`, `targetId`), edges as
 * `Edge` values, and counts and percents as numbers. Each missing string takes
 * its English default.
 */
export interface LayoutMessages {
  /** The name of the layout. Default: "Workspace". */
  readonly layout?: string;
  /**
   * The announcement of a change from elsewhere, such as the operations of a
   * server or an agent that `applyOperations` applies: `text` is what the same
   * change from this window announces, for example "Editor moved to the right
   * of Files". Default: none, so a remote change is silent.
   */
  readonly remote?: (values: { readonly text: string }) => string;
  /**
   * The name of a separator, from its primary pane: the panes that show
   * before it, whose size its value gives. Default: "Resize Files".
   */
  readonly separator?: (values: SeparatorMessageValues) => string;
  /**
   * The value of a separator: the title of its primary pane and the place of
   * the separator in percent. Default: "Files 25%".
   */
  readonly separatorValue?: (
    values: PaneMessageValues & { readonly percent: number }
  ) => string;
  /** The name of `Layout.CollapseButton`. Default: "Collapse Editor". */
  readonly collapse?: (values: PaneMessageValues) => string;
  /** The name of `Layout.CloseButton`. Default: "Close Editor". */
  readonly close?: (values: PaneMessageValues) => string;
  /**
   * The name of `Layout.ZoomButton`. It does not change while the pane is
   * zoomed: `aria-pressed` gives the state. Default: "Zoom Editor".
   */
  readonly zoom?: (values: PaneMessageValues) => string;
  /** The announcement of a zoom. Default: "Editor zoomed". */
  readonly zoomed?: (values: PaneMessageValues) => string;
  /** The announcement of the end of a zoom. Default: "Editor restored". */
  readonly restored?: (values: PaneMessageValues) => string;
  /** The announcement of a close. Default: "Editor closed". */
  readonly closed?: (values: PaneMessageValues) => string;
  /**
   * The announcement of a new pane at an edge of another. Default: "Terminal
   * opened to the bottom of Editor".
   */
  readonly opened?: (values: EdgeMessageValues) => string;
  /**
   * The announcement of a move to an edge of another pane. Default: "Editor
   * moved to the right of Files".
   */
  readonly moved?: (values: EdgeMessageValues) => string;
  /**
   * The announcement of a new pane at an edge of a split, such as the root.
   * Default: "Terminal opened in a new row at the bottom".
   */
  readonly openedAtEdge?: (
    values: PaneMessageValues & { readonly edge: Edge }
  ) => string;
  /**
   * The announcement of a move to an edge of a split, such as the root.
   * Default: "Editor moved to a new column at the left".
   */
  readonly movedToEdge?: (
    values: PaneMessageValues & { readonly edge: Edge }
  ) => string;
  /**
   * The announcement of a move into another stack. Default: "Editor moved
   * into the group of Files".
   */
  readonly movedToTabs?: (values: TargetMessageValues) => string;
  /** The announcement of a collapse. Default: "Editor collapsed". */
  readonly collapsed?: (values: PaneMessageValues) => string;
  /** The announcement of an expand. Default: "Editor expanded". */
  readonly expanded?: (values: PaneMessageValues) => string;
  /** The announcement of a hide. Default: "Editor hidden". */
  readonly hidden?: (values: PaneMessageValues) => string;
  /** The announcement of a show. Default: "Editor shown". */
  readonly shown?: (values: PaneMessageValues) => string;
  /** The name of `Layout.MoveHandle`. Default: "Drag Editor". */
  readonly drag?: (values: PaneMessageValues) => string;
  /**
   * The status message during a pane drag or a tab drag to an edge of a
   * target pane. Default: "Move Editor to the right of Files".
   */
  readonly move?: (values: EdgeMessageValues) => string;
  /** The name of `Layout.TabList`. Default: "Tabs of Editor". */
  readonly tabs?: (values: PaneMessageValues) => string;
  /** The description of a pinned tab. Default: "Pinned". */
  readonly pinned?: string;
  /**
   * The status message during a tab drag into a stack: the tab and a pane of
   * the target stack. Default: "Move Editor into the group of Files".
   */
  readonly moveInto?: (values: TargetMessageValues) => string;
}

/** A layout object: the store, with the features of the layout. */
export type ViewStore = CoreLayoutStore & {
  readonly features: readonly FeatureModule[];
};

/** What features and parts use. It is stable for the life of `Root`. */
export interface ViewContext {
  readonly store: ViewStore;
  /** The prefix of the element IDs of this layout. */
  readonly prefix: string;
  readonly view: ViewState;
  /** The visibility of the pane hosts: the only writer of `inert` on them. */
  readonly visibility: PaneVisibility;
  /** The layout element, or null before it mounts. */
  element(): HTMLElement | null;
  /** The compiled CSS of a tree, cached for each tree and gap. */
  cssLayoutOf(root: LayoutNode): CSSLayout;
  /** The pixel geometry of the current tree at the layout's current size. */
  readGeometry(): LayoutGeometry;
  /**
   * A number that grows by one with each store change, before the
   * `beforeChange` hooks run. Features use it to share the work of one
   * change, such as the boxes that the zoom and the FLIP animation read
   * before any feature writes to the DOM.
   */
  change(): number;
  startGesture(gesture: Gesture): void;
  startResize(event: PointerEvent<HTMLElement>, ids: readonly string[]): void;
  resizeKey(event: KeyboardEvent<HTMLElement>, ids: readonly string[]): void;
  /** True during a pointer resize. */
  resizing(): boolean;
  /** The title of a pane, from `getPaneTitle`. */
  title(pane: PaneNode): string;
  /** A number that grows by one each time `getPaneTitle` changes. */
  titles(): number;
  /** Call `listener` after `getPaneTitle` changes. */
  onTitles(listener: () => void): () => void;
  onPaneClose(): ((pane: PaneNode) => void) | undefined;
  /** The hooks of every feature, from the last render. */
  hooks(): readonly FeatureHooks[];
  /** True when the layout has the feature of this name. */
  has(name: string): boolean;
  /** The `stylesheets` setting of `Root`. */
  stylesheets(): StylesheetsSetting;
  /** The `messages` of `Root`. */
  messages(): LayoutMessages;
}

/** What `Root` renders, for the view part of each feature. */
export interface ViewRender {
  readonly state: LayoutState;
  readonly geometry: CSSLayout;
  readonly gap: number;
  readonly visibleCount: number;
}

/**
 * What a feature changes on a pane host. One feature gives the style of a
 * host: with two, the feature whose name comes last wins, and a development
 * build warns. The visibility of a host is not here:
 * `ViewContext.visibility` owns it.
 */
export interface HostPatch {
  readonly attributes?: Readonly<Record<string, string | boolean | undefined>>;
  readonly style?: CSSProperties;
}

/** The view part of a feature, for one render of `Root`. */
export interface FeatureHooks {
  /**
   * Before React renders a store change. The layout's boxes are clean here,
   * so read the DOM before any write to it. `change` holds the operations of
   * the change: none for a transient change.
   */
  beforeChange?(
    previous: LayoutState,
    next: LayoutState,
    element: HTMLElement,
    change: LayoutChange
  ): void;
  /** After React commits a state, before the browser paints. */
  afterChange?(
    previous: LayoutState | null,
    next: LayoutState,
    element: HTMLElement
  ): void;
  /** The key commands of the feature, with their default keys. */
  keys?: readonly KeyCommand[];
  host?(host: CSSPane): HostPatch | undefined;
  /** Elements after the separators, such as the focus ring or the corners. */
  layers?(): ReactNode;
  /** False hides the separators, for example while a pane is zoomed. */
  separators?: boolean;
  /**
   * Apply the sizes of a pointer resize, in place of `store.setSizes`. One
   * feature fills this slot, as for the style of a host.
   */
  applySizes?(
    element: HTMLElement,
    separators: readonly SeparatorGeometry[],
    sizes: Sizes
  ): void;
  /** The end of a pointer resize, for the feature that applies its sizes. */
  endResize?(cancel: boolean): void;
  /**
   * The text of the status message during a gesture, such as the place of a
   * drop. It comes before the announcement of the last change.
   */
  status?: string | null;
  /** For `MoveHandle`: start a move drag of a pane. */
  startMove?(paneId: string, event: PointerEvent<HTMLElement>): void;
  /**
   * For `Tab`: start a drag of a tab from a pointer press. `tabs` holds the
   * tabs of its tab list. Parts call the hooks in their events, after `Root`
   * commits, so a slot is never read during a render.
   */
  startTabDrag?(
    tab: PaneNode,
    tabs: readonly PaneNode[],
    event: PointerEvent<HTMLElement>
  ): void;
  /** For `Tab`: show a tab, and give it the focus after the change. */
  selectTab?(id: string): void;
  /** For `Tab`: move a tab to an index among the tabs of its stack, and keep the focus on it. */
  moveTab?(id: string, index: number): void;
  /** Focus the tab of a pane after the next change, in the host that shows it. */
  focusTab?(id: string): void;
}

/**
 * A named key command (`DEC-layouts-pane-commands`). `Root` runs it for a key
 * of `keys`, or for the keys that its `keymap` prop gives the ID. A command
 * in the capture phase runs before pane content; the others run on a key
 * that pane content did not handle, outside a text field and outside a
 * composition.
 */
export interface KeyCommand {
  /** The ID of the command, for example `zoom.restore`. */
  readonly id: string;
  /** The default keys, for example `Escape` or `Mod+Shift+ArrowLeft`. */
  readonly keys: readonly string[];
  /** Run before pane content gets the key: pane focus only. */
  readonly capture?: boolean;
  /**
   * Run the command. False when it does nothing, so that the key goes on;
   * true stops the key.
   */
  run(event: globalThis.KeyboardEvent): boolean;
}

/** What the announcement of an operation reads. */
export interface AnnounceContext {
  /** The state before the change and after it. */
  readonly previous: LayoutState;
  readonly next: LayoutState;
  /** The title of a pane, from the state after the change or before it. */
  title(id: string): string;
  /** The values of a message about a pane: its title and its ID. */
  pane(id: string): PaneMessageValues;
  /** The values of a message about a target pane: its title and its ID. */
  target(id: string): Pick<TargetMessageValues, 'targetTitle' | 'targetId'>;
  readonly messages: LayoutMessages;
}

// The brand of a feature, which carries the type of the commands that it adds
// to a layout object. No value has it at run time.
declare const featureCommands: unique symbol;

/**
 * A feature of a layout, for `createLayout`: a value that a function of
 * `@pierre/layouts/react` returns, such as `edits(naryTree)` or `zoom()`.
 * `Commands` types the commands that it adds to the layout object. Its members
 * are internal to the library, so an app does not write a feature.
 */
export interface Feature<Commands extends object = object> {
  readonly [featureCommands]?: Commands;
}

/**
 * A feature with its members, inside the library: its store part (commands),
 * its view part (a hook that runs on each render of `Root`), and its sheets.
 */
export interface FeatureModule<
  Commands extends object = object,
> extends Feature<Commands> {
  readonly name: string;
  /**
   * The names of the features that this feature needs in the same layout.
   * `createLayout` warns in development when one is missing.
   */
  readonly requires?: readonly string[];
  readonly store?: StoreFeature<Commands>;
  /**
   * The announcement of an operation of the feature, for a local change, or
   * null. `Root` speaks the announcement of the last operation that has one.
   */
  announce?(
    operation: LayoutOperation,
    context: AnnounceContext
  ): string | null;
  use?(context: ViewContext, render: ViewRender): FeatureHooks;
  /**
   * Sheets inside `@layer pierre-layouts`, by name. `Root` renders each sheet
   * once per document; two features can name the same sheet.
   */
  readonly stylesheets?: readonly (readonly [name: string, css: string])[];
}

/** The pane of a part, from the output of `renderPane`. */
export interface PaneContextValue {
  readonly id: string;
  readonly context: ViewContext;
}

export const PaneContext: Context<PaneContextValue | null> =
  /* @__PURE__ */ createContext<PaneContextValue | null>(null);

/** The tab of a `Tab`, from its `TabList`: its pane, and the tabs that show in the list. */
export interface TabContextValue {
  readonly tab: PaneNode;
  readonly tabs: readonly PaneNode[];
  /** The arrows move the focus only, and Enter or Space selects. */
  readonly manual: boolean;
}

export const TabContext: Context<TabContextValue | null> =
  /* @__PURE__ */ createContext<TabContextValue | null>(null);

/** The ID of the host of a pane. */
export const paneIdOf = (prefix: string, pane: string): string =>
  `${prefix}-${encodeURIComponent(pane)}`;

/**
 * The ID of the tab of a pane in the tab list of a host. Each host of a stack
 * renders the tabs of the stack, so a tab ID names the host too.
 */
export const tabIdOf = (prefix: string, host: string, tab: string): string =>
  `${prefix}-tab-${encodeURIComponent(host)}~${encodeURIComponent(tab)}`;

/**
 * A sheet of the layout. React 19 renders a `<style>` with `href` and
 * `precedence` once per document, in `document.head`, also during server
 * rendering. With the `stylesheets` setting `null`, nothing renders.
 */
export function Style({
  name,
  css,
  settings,
}: {
  name: string;
  css: string;
  settings: StylesheetsSetting;
}): ReactNode {
  if (settings === null) return null;
  return (
    <style
      href={`pierre-layouts-${name}`}
      precedence="pierre-layouts"
      nonce={settings?.nonce}
    >
      {css}
    </style>
  );
}
