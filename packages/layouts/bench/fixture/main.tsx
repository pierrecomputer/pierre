import { type JSX, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { type LayoutNode, LayoutStore, type PaneNode } from '../../src';
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
  requestedResize === 'freeze'
    ? requestedResize
    : 'live';
// Experimental paint isolation of pane content, for the resize drag exploration.
const isolate = params.get('isolate');
if (isolate === 'contain' || isolate === 'layer') {
  const sheet = document.createElement('style');
  sheet.textContent =
    isolate === 'contain'
      ? '.pierre-layout-content { contain: strict; }'
      : '.pierre-layout-pane { will-change: transform; }';
  document.head.append(sheet);
}
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
    ratio: middle / ids.length,
    first: buildTree(ids.slice(0, middle), depth + 1),
    second: buildTree(ids.slice(middle), depth + 1),
  };
}

const store = new LayoutStore(buildTree(paneIds));

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
      />
    </div>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Missing benchmark root');
createRoot(root).render(<Bench />);
