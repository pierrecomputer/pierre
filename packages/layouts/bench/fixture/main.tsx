import { type JSX, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { LayoutNode, PaneNode } from '../../src';
import * as Layout from '../../src/react';
import {
  allFeatures,
  createLayout,
  hiddenContent,
  type LayoutObject,
  naryTree,
} from '../../src/react';
import { resizeStrategy } from '../../src/react/features/resize-strategy';
import { setPaneLayers } from '../../src/react/pane-layers';
import {
  appendTo,
  type ContentWeight,
  counters,
  kindOf,
  PaneContent,
  resetCounters,
} from './content';
import { BenchOverlays, type OverlayState } from './overlays';
import './style.css';

/** The page API that the benchmark scenarios drive through `page.evaluate`. */
export interface LayoutsBench {
  ready: boolean;
  paneCount: number;
  weight: ContentWeight;
  paneIds: string[];
  store: LayoutObject<ReturnType<typeof allFeatures>>;
  counters(): {
    renders: number;
    resizeCallbacks: number;
    perPane: Record<string, { renders: number; resizeCallbacks: number }>;
  };
  resetCounters(): void;
  append(id: string): void;
  busy(milliseconds: number): void;
  /**
   * Mount the modal and the drawer, closed. The promise resolves when their
   * handles exist, so that their first render is not in a trace.
   */
  mountOverlays(): Promise<void>;
  /** Open or close an overlay, as an app's state change does. */
  setOverlay(overlay: keyof OverlayState, open: boolean): void;
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
  contain: '.pierre-layouts-content { contain: strict; }',
  layer: '.pierre-layouts-pane { will-change: transform; }',
  'content-layer':
    '.pierre-layouts-content { contain: strict; will-change: transform; }',
};
if (isolate !== null && isolate in ISOLATION) {
  const sheet = document.createElement('style');
  sheet.textContent = ISOLATION[isolate];
  document.head.append(sheet);
}
// The pane layers: `on`, `off`, or a number of panes from which the layers
// start. Without the parameter, the policy has its default. The policy is an
// internal setting of the library (`DEC-layouts-experiments-internal`).
const requestedLayers = params.get('layers');
if (requestedLayers === 'on' || requestedLayers === 'off')
  setPaneLayers(requestedLayers === 'on');
else if (requestedLayers !== null && /^\d+$/.test(requestedLayers))
  setPaneLayers({ minPanes: Number(requestedLayers) });
// What the content of a pane that does not show does (`hiddenContent()`):
// `hidden=activity` or `hidden=unmount`; without the parameter, it stays
// mounted, with no feature.
const requestedHidden = params.get('hidden');
const hiding =
  requestedHidden === 'activity' || requestedHidden === 'unmount'
    ? [hiddenContent(requestedHidden)]
    : [];
// The modal strategy: `popover` (the default), `dialog-hide-covered`, or
// `dialog`; and `backdrop=opaque` for a backdrop that hides the page.
const requestedModal = params.get('modal');
const modalStrategy =
  requestedModal === 'dialog' || requestedModal === 'dialog-hide-covered'
    ? requestedModal
    : 'popover';
const backdrop = params.get('backdrop') === 'opaque' ? 'opaque' : 'translucent';
const paneIds = Array.from({ length: paneCount }, (_, index) => `p${index}`);
const MESSAGES = { layout: 'Benchmark workspace' };
const indexOf = new Map(paneIds.map((id, index) => [id, index]));

// Build a balanced tree that alternates the split direction at each depth.
function buildTree(ids: readonly string[], depth = 0): LayoutNode {
  // A pane collapses to its header: 36 px and the borders.
  if (ids.length === 1)
    return {
      type: 'pane',
      id: ids[0],
      minWidth: 48,
      minHeight: 48,
      collapsedSize: 38,
    };
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

// Every feature, with the tree model of the apps, and the resize strategy of
// the run, which is an internal feature (`DEC-layouts-experiments-internal`).
const store = createLayout(buildTree(paneIds), [
  ...allFeatures({ model: naryTree }),
  ...hiding,
  resizeStrategy(resize),
]);

const title = (pane: PaneNode): string =>
  `${pane.id} ${kindOf(indexOf.get(pane.id) ?? 0)}`;

// The tabs of a pane in a stack, or the title of a lone pane, as the default
// header of the \`Layout\` component before showed them.
function TabsOrTitle({
  tab,
}: {
  tab?: (tab: PaneNode) => JSX.Element;
}): JSX.Element {
  const stacked = Layout.usePane((state) => state.tabs.length > 1);
  return stacked ? <Layout.TabList>{tab}</Layout.TabList> : <Layout.Title />;
}

// The header of each pane, as the default header of the `Layout` component
// before it: a move handle, the tabs or the title, and the zoom and close
// buttons.
const renderPane = (pane: PaneNode): JSX.Element => (
  <>
    <Layout.Header>
      <Layout.MoveHandle />
      <TabsOrTitle />
      <Layout.ZoomButton />
      <Layout.CloseButton />
    </Layout.Header>
    <Layout.Content>
      <PaneContent
        id={pane.id}
        index={indexOf.get(pane.id) ?? paneIds.length}
        weight={weight}
      />
    </Layout.Content>
  </>
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
  // The Bench component replaces these when it mounts.
  mountOverlays: () => Promise.resolve(),
  setOverlay() {},
};

const nextFrames = (): Promise<void> =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );

function Bench(): JSX.Element {
  const workspace = useRef<HTMLDivElement>(null);
  const [overlaysMounted, setOverlaysMounted] = useState(false);
  const [overlays, setOverlays] = useState<OverlayState>({
    modal: false,
    drawer: false,
  });
  useEffect(() => {
    const bench = window.__layoutsBench;
    bench.mountOverlays = async () => {
      setOverlaysMounted(true);
      await nextFrames();
    };
    bench.setOverlay = (overlay, open) =>
      setOverlays((state) => ({ ...state, [overlay]: open }));
    // Ready after two frames, so that the first layout and paint are complete.
    void nextFrames().then(() => {
      bench.ready = true;
    });
  }, []);
  return (
    <>
      <div className="bench-workspace" ref={workspace}>
        <Layout.Root
          layout={store}
          renderPane={renderPane}
          getPaneTitle={title}
          messages={MESSAGES}
        />
      </div>
      {overlaysMounted && (
        <BenchOverlays
          workspace={workspace}
          state={overlays}
          onClose={(overlay) =>
            setOverlays((state) => ({ ...state, [overlay]: false }))
          }
          strategy={modalStrategy}
          backdrop={backdrop}
        />
      )}
    </>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Missing benchmark root');
createRoot(root).render(<Bench />);
