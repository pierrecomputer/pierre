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

/** The start of a resize, for `onResizeStart` of the `Layout` component. */
export interface LayoutResizeContext {
  /** The separator or the corner that the user resizes with. */
  element: HTMLElement;
  /** The pixel geometry of the separators that the resize changes. */
  separators: readonly SeparatorGeometry[];
  source: 'pointer' | 'keyboard';
}

/**
 * An app's part in one resize: a pointer drag from press to release, or one
 * key press.
 */
export interface LayoutResizeSession {
  /**
   * Returns the sizes to apply in place of the proposed sizes, for example
   * sizes that snap to a position. `point` is the pointer position, or null
   * for a keyboard resize.
   */
  update?: (
    sizes: Record<string, ChildSize[]>,
    point: { clientX: number; clientY: number } | null
  ) => Record<string, ChildSize[]>;
  /**
   * Called once when the resize ends: with `false` after it applies, and with
   * `true` after a cancellation or an unmount, which restore the sizes from
   * before the resize.
   */
  end?: (cancelled: boolean) => void;
}

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

/**
 * The strings that the library owns, for the `messages` prop of `Root`. A
 * string that names a pane uses its title from `getPaneTitle`. Each missing
 * string takes its English default.
 */
export interface LayoutMessages {
  /** The name of the layout. Default: "Workspace". */
  readonly layout?: string;
  /** The status message with the count of panes that show. Default: "2 panes". */
  readonly paneCount?: (count: number) => string;
  /**
   * The name of a separator, from the titles of the panes that it resizes
   * first on each side. Default: "Resize Files and Editor".
   */
  readonly separator?: (
    before: readonly string[],
    after: readonly string[]
  ) => string;
  /** The value of a separator: its preferred place in percent. Default: "50% preferred position". */
  readonly separatorValue?: (percent: number) => string;
  /** The name of `Layout.CollapseButton`. Default: "Collapse Editor". */
  readonly collapse?: (title: string) => string;
  /** The name of `Layout.CloseButton`. Default: "Close Editor". */
  readonly close?: (title: string) => string;
  /**
   * The name of `Layout.ZoomButton`, for a pane that is zoomed or not.
   * Default: "Zoom Editor", or "Restore Editor" while it is zoomed.
   */
  readonly zoom?: (title: string, zoomed: boolean) => string;
  /** The status message while a pane is zoomed. Default: "Editor zoomed". */
  readonly zoomed?: (title: string) => string;
  /** The name of `Layout.MoveHandle`. Default: "Drag Editor". */
  readonly drag?: (title: string) => string;
  /**
   * The status message during a pane drag: the pane, the edge, and the target
   * pane. Default: "Move Editor to the right of Files".
   */
  readonly move?: (title: string, edge: Edge, target: string) => string;
  /** The name of a corner of `corners()`. Default: "Resize both axes". */
  readonly corner?: string;
  /** The name of `Layout.TabList`. Default: "Tabs of Editor". */
  readonly tabs?: (title: string) => string;
  /**
   * The status message during a tab drag into a stack: the tab and a pane of
   * the target stack. Default: "Move Editor into the group of Files".
   */
  readonly moveInto?: (title: string, target: string) => string;
}

/** A layout object: the store, with the features of the layout. */
export type ViewStore = CoreLayoutStore & {
  readonly features: readonly Feature[];
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
   * so read the DOM before any write to it.
   */
  beforeChange?(
    previous: LayoutState,
    next: LayoutState,
    element: HTMLElement
  ): void;
  /** After React commits a state, before the browser paints. */
  afterChange?(
    previous: LayoutState | null,
    next: LayoutState,
    element: HTMLElement
  ): void;
  /** Keys on the layout that pane content did not handle. */
  keys?: Readonly<Record<string, (event: KeyboardEvent<HTMLElement>) => void>>;
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
  /** The text of the status message, in place of the count of panes. */
  announce?: string | null;
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
 * A feature of a layout: its store part (commands), its view part (a hook
 * that runs on each render of `Root`), and its sheets. `Commands` types the
 * commands of the layout object.
 */
export interface Feature<Commands extends object = object> {
  readonly name: string;
  /**
   * The names of the features that this feature needs in the same layout.
   * `createLayout` warns in development when one is missing.
   */
  readonly requires?: readonly string[];
  readonly store?: StoreFeature<Commands>;
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
