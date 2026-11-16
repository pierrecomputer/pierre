'use client';

// `Layout.usePane`: the state of a pane, for app code and parts in the output
// of `renderPane`. Each pane has one store of its state, which subscribes to
// the layout once for all the components of the pane.
import { useContext, useRef, useSyncExternalStore } from 'react';

import {
  ALL_EDGES,
  type CSSLayout,
  type CSSPane,
  type PaneEdges,
} from '../css-layout';
import { HOST_HIDDEN } from '../dom/visibility';
import { presentation } from '../presentation';
import { treeIndex } from '../tree-index';
import type { LayoutState, PaneNode } from '../types';
import { PaneContext, type PaneContextValue } from './contract';

/** The state of a pane, for `Layout.usePane`. */
export interface PaneState {
  /** The ID of the pane. */
  readonly id: string;
  readonly pane: PaneNode;
  /** The title of the pane, from `getPaneTitle` of `Root`. */
  readonly title: string;
  /**
   * The pane shows: it is not hidden, an inactive tab, or covered, and it does
   * not collapse to 0 pixels.
   */
  readonly shown: boolean;
  /** The pane has the focus of the layout. */
  readonly focused: boolean;
  readonly zoomed: boolean;
  /** The pane, or its stack, is collapsed. */
  readonly collapsed: boolean;
  /** The edges of the layout that the pane touches: all of them when it is zoomed. */
  readonly edges: PaneEdges;
  /** The panes of the stack of the pane, in the order of their tabs, or the pane alone. */
  readonly tabs: readonly PaneNode[];
  /** The ID of the pane that shows in the stack, or the ID of the pane alone. */
  readonly activeTab: string;
}

/** The state of one pane, shared by every component of the pane. */
interface PaneStore {
  get(): PaneState;
  subscribe(listener: () => void): () => void;
}

const NO_EDGES: PaneEdges = {
  top: false,
  right: false,
  bottom: false,
  left: false,
};

const EDGES = ['top', 'right', 'bottom', 'left'] as const;

const sameEdges = (a: PaneEdges, b: PaneEdges): boolean =>
  EDGES.every((edge) => a[edge] === b[edge]);

const sameTabs = (a: readonly PaneNode[], b: readonly PaneNode[]): boolean =>
  a.length === b.length && a.every((tab, index) => tab === b[index]);

// The edges and the tabs of the two states keep their identity while their
// values do not change, so they compare by identity.
const samePaneState = (a: PaneState, b: PaneState): boolean =>
  a.pane === b.pane &&
  a.title === b.title &&
  a.shown === b.shown &&
  a.focused === b.focused &&
  a.zoomed === b.zoomed &&
  a.collapsed === b.collapsed &&
  a.activeTab === b.activeTab &&
  a.edges === b.edges &&
  a.tabs === b.tabs;

// The panes of each compiled tree by ID, for the edges of a pane.
const cssPanes = new WeakMap<CSSLayout, Map<string, CSSPane>>();

function cssPaneOf(layout: CSSLayout, id: string): CSSPane | undefined {
  let byId = cssPanes.get(layout);
  if (byId === undefined) {
    byId = new Map(layout.panes.map((host) => [host.pane.id, host]));
    cssPanes.set(layout, byId);
  }
  return byId.get(id);
}

const paneStores = new WeakMap<PaneContextValue, PaneStore>();

/**
 * The store of the state of a pane. It subscribes to the layout, to the
 * visibility of the pane, and to the titles while a component reads it, and it
 * keeps its state object while the values do not change, so a change in
 * another pane, or a new `getPaneTitle` that gives this pane the same title,
 * notifies no component of this pane.
 */
function paneStoreOf(value: PaneContextValue): PaneStore {
  let paneStore = paneStores.get(value);
  if (paneStore !== undefined) return paneStore;
  const { id, context } = value;
  const { store, visibility } = context;
  const listeners = new Set<() => void>();
  let current: PaneState | null = null;
  let state: LayoutState | null = null;
  let reasons = 0;
  let titles = 0;
  let stop: (() => void) | undefined;
  const get = (): PaneState => {
    const nextState = store.getSnapshot();
    const nextReasons = visibility.reasons(id);
    const nextTitles = context.titles();
    if (
      current !== null &&
      nextState === state &&
      nextReasons === reasons &&
      nextTitles === titles
    )
      return current;
    state = nextState;
    reasons = nextReasons;
    titles = nextTitles;
    const entry = treeIndex(nextState.root).panes.get(id);
    // A pane that leaves the tree keeps its last state until it unmounts.
    if (entry === undefined && current !== null) return current;
    const pane = entry?.pane ?? { type: 'pane', id };
    const stack = entry?.stack ?? null;
    const zoomed = presentation(nextState).filled === id;
    const edges = zoomed
      ? ALL_EDGES
      : (cssPaneOf(context.cssLayoutOf(nextState.root), id)?.edges ?? NO_EDGES);
    const tabs = stack?.children ?? [pane];
    const next: PaneState = {
      id,
      pane,
      title: context.title(pane),
      shown: (nextReasons & HOST_HIDDEN) === 0,
      focused: nextState.focusedPane === id,
      zoomed,
      collapsed: (stack ?? pane).collapsed === true,
      edges:
        current !== null && sameEdges(current.edges, edges)
          ? current.edges
          : edges,
      tabs:
        current !== null && sameTabs(current.tabs, tabs) ? current.tabs : tabs,
      activeTab: stack?.active ?? id,
    };
    if (current === null || !samePaneState(current, next)) current = next;
    return current;
  };
  const check = (): void => {
    const before = current;
    if (get() !== before) for (const listener of [...listeners]) listener();
  };
  paneStore = {
    get,
    subscribe(listener) {
      if (listeners.size === 0) {
        get();
        const stopStore = store.subscribe(check);
        const stopVisibility = visibility.subscribe(check);
        const stopTitles = context.onTitles(check);
        stop = () => {
          stopStore();
          stopVisibility();
          stopTitles();
        };
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop?.();
      };
    },
  };
  paneStores.set(value, paneStore);
  return paneStore;
}

/** The pane of a part or a hook. Outside the output of `renderPane`, it throws. */
export function usePaneContext(name: string): PaneContextValue {
  const value = useContext(PaneContext);
  if (value === null)
    throw new Error(`${name} must be in the output of renderPane`);
  return value;
}

/** A value of the state of a pane; the component renders when it changes. */
export function usePaneState<T>(
  value: PaneContextValue,
  select: (pane: PaneState) => T
): T {
  const paneStore = paneStoreOf(value);
  // The last value of `select`, so that a selector that returns a new object
  // gives the same object while the state of the pane does not change.
  const last = useRef<{
    state: PaneState;
    select: (pane: PaneState) => T;
    value: T;
  } | null>(null);
  const get = (): T => {
    const state = paneStore.get();
    if (
      last.current === null ||
      last.current.state !== state ||
      last.current.select !== select
    )
      last.current = { state, select, value: select(state) };
    return last.current.value;
  };
  return useSyncExternalStore(paneStore.subscribe, get, get);
}

/**
 * Read the state of the pane of a component in the output of `renderPane`,
 * for example `Layout.usePane((pane) => pane.focused)`. The component renders
 * again only when the value of `select` changes, so a change in one pane
 * renders only the components of that pane that read the change.
 */
export function usePane<T>(select: (pane: PaneState) => T): T {
  return usePaneState(usePaneContext('Layout.usePane'), select);
}
