import { type JSX, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import {
  binaryTree,
  type LayoutNode,
  LayoutStore,
  naryTree,
  type PaneNode,
} from '../../src';
import { Layout } from '../../src/react';
import '../../src/styles.css';
import {
  appendTo,
  type ContentWeight,
  counters,
  kindOf,
  PaneContent,
  resetCounters,
} from './content';
import './style.css';

/** The page API that the benchmark scenarios drive through `page.evaluate`. */
export interface LayoutsBench {
  ready: boolean;
  paneCount: number;
  weight: ContentWeight;
  paneIds: string[];
  store: LayoutStore;
  counters(): {
    renders: number;
    resizeCallbacks: number;
    perPane: Record<string, { renders: number; resizeCallbacks: number }>;
  };
  resetCounters(): void;
  append(id: string): void;
  busy(milliseconds: number): void;
}

declare global {
  interface Window {
    __layoutsBench: LayoutsBench;
  }
}

const params = new URLSearchParams(location.search);
const requestedPanes = Number.parseInt(params.get('panes') ?? '4', 10);
const paneCount = Number.isNaN(requestedPanes)
  ? 4
  : Math.min(64, Math.max(1, requestedPanes));
const requestedWeight = params.get('content');
const weight: ContentWeight =
  requestedWeight === 'heavy' || requestedWeight === 'real'
    ? requestedWeight
    : 'light';
const requestedResize = params.get('resize');
const resize =
  requestedResize === 'frame' ||
  requestedResize === 'preview' ||
  requestedResize === 'freeze' ||
  requestedResize === 'settle'
    ? requestedResize
    : 'live';
// Experimental paint isolation of pane content, for the resize drag exploration.
// `layer` adds `will-change: transform` to each pane host, the layer of the
// pane hosts from 40389155 until the layer came from `translateZ(0)`; with
// `layers=off`, it is that layer alone.
const isolate = params.get('isolate');
const ISOLATION: Record<string, string> = {
  contain: '.pierre-layout-content { contain: strict; }',
  layer: '.pierre-layout-pane { will-change: transform; }',
  'content-layer':
    '.pierre-layout-content { contain: strict; will-change: transform; }',
};
if (isolate !== null && isolate in ISOLATION) {
  const sheet = document.createElement('style');
  sheet.textContent = ISOLATION[isolate];
  document.head.append(sheet);
}
// The paneLayers option: `on`, `off`, or a number of panes from which the
// layers start. Without the parameter, the option has its default.
const requestedLayers = params.get('layers');
const paneLayers: boolean | { minPanes: number } | undefined =
  requestedLayers === 'on'
    ? true
    : requestedLayers === 'off'
      ? false
      : requestedLayers !== null && /^\d+$/.test(requestedLayers)
        ? { minPanes: Number(requestedLayers) }
        : undefined;
const paneIds = Array.from({ length: paneCount }, (_, index) => `p${index}`);
const indexOf = new Map(paneIds.map((id, index) => [id, index]));

// Build a balanced tree that alternates the split direction at each depth.
function buildTree(ids: readonly string[], depth = 0): LayoutNode {
  if (ids.length === 1)
    return { type: 'pane', id: ids[0], minWidth: 48, minHeight: 48 };
  const middle = Math.ceil(ids.length / 2);
  return {
    type: 'split',
    id: `s${depth}-${ids[0]}`,
    direction: depth % 2 === 0 ? 'horizontal' : 'vertical',
    children: [
      buildTree(ids.slice(0, middle), depth + 1),
      buildTree(ids.slice(middle), depth + 1),
    ],
    sizes: [middle / ids.length, 1 - middle / ids.length],
  };
}

// The tree model: `binary` by default, or `n-ary`. The balanced tree has the
// same shape in both, but a split, a close, or a move can change it in
// different ways.
const model = params.get('model') === 'n-ary' ? naryTree : binaryTree;
const store = new LayoutStore(buildTree(paneIds), { model });

const title = (pane: PaneNode): string =>
  `${pane.id} ${kindOf(indexOf.get(pane.id) ?? 0)}`;

const renderPane = (pane: PaneNode): JSX.Element => (
  <PaneContent
    id={pane.id}
    index={indexOf.get(pane.id) ?? paneIds.length}
    weight={weight}
  />
);

function sum(map: Map<string, number>): number {
  let total = 0;
  for (const value of map.values()) total += value;
  return total;
}

window.__layoutsBench = {
  ready: false,
  paneCount,
  weight,
  paneIds,
  store,
  counters() {
    const perPane: Record<
      string,
      { renders: number; resizeCallbacks: number }
    > = {};
    for (const id of new Set([
      ...counters.renders.keys(),
      ...counters.resizeCallbacks.keys(),
    ])) {
      perPane[id] = {
        renders: counters.renders.get(id) ?? 0,
        resizeCallbacks: counters.resizeCallbacks.get(id) ?? 0,
      };
    }
    return {
      renders: sum(counters.renders),
      resizeCallbacks: sum(counters.resizeCallbacks),
      perPane,
    };
  },
  resetCounters,
  append: appendTo,
  busy(milliseconds) {
    const end = performance.now() + milliseconds;
    while (performance.now() < end) {
      // Block the main thread, as a long task in the app would.
    }
  },
};

function Bench(): JSX.Element {
  useEffect(() => {
    // Ready after two frames, so that the first layout and paint are complete.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.__layoutsBench.ready = true;
      })
    );
  }, []);
  return (
    <div className="bench-workspace">
      <Layout
        store={store}
        renderPane={renderPane}
        getPaneTitle={title}
        label="Benchmark workspace"
        experimentalResize={resize}
        paneLayers={paneLayers}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Missing benchmark root');
createRoot(root).render(<Bench />);
