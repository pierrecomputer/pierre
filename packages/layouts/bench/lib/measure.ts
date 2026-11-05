import type { Browser, CDPSession, Page } from '@playwright/test';

import {
  analyzeTrace,
  ATTRIBUTION_CATEGORIES,
  TRACE_CATEGORIES,
  type TraceSummary,
} from './trace';

/** One measured run of one scenario: trace data, CDP counters, and content counters. */
export interface Sample extends TraceSummary {
  cdpLayoutCount: number;
  cdpRecalcStyleCount: number;
  cdpLayoutMs: number;
  cdpRecalcStyleMs: number;
  cdpScriptMs: number;
  cdpTaskMs: number;
  contentRenders: number;
  contentResizeCallbacks: number;
}

const CDP_METRICS = {
  LayoutCount: 'cdpLayoutCount',
  RecalcStyleCount: 'cdpRecalcStyleCount',
  LayoutDuration: 'cdpLayoutMs',
  RecalcStyleDuration: 'cdpRecalcStyleMs',
  ScriptDuration: 'cdpScriptMs',
  TaskDuration: 'cdpTaskMs',
} as const;

type CdpMetricName = keyof typeof CDP_METRICS;

async function readCdpMetrics(
  session: CDPSession
): Promise<Record<CdpMetricName, number>> {
  const { metrics } = await session.send('Performance.getMetrics');
  const values = {} as Record<CdpMetricName, number>;
  for (const name of Object.keys(CDP_METRICS) as CdpMetricName[]) {
    values[name] = metrics.find((metric) => metric.name === name)?.value ?? 0;
  }
  return values;
}

/** The display that a run measures: its frame interval and its device pixel ratio. */
export async function probeDisplay(
  page: Page
): Promise<{ refreshHz: number; frameMs: number; deviceScaleFactor: number }> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const times: number[] = [];
        const step = (time: number): void => {
          times.push(time);
          if (times.length < 31) {
            requestAnimationFrame(step);
            return;
          }
          const intervals = times
            .slice(1)
            .map((value, index) => value - times[index])
            .sort((a, b) => a - b);
          const frameMs = intervals[Math.floor(intervals.length / 2)];
          resolve({
            refreshHz: Math.round(1000 / frameMs),
            frameMs,
            deviceScaleFactor: window.devicePixelRatio,
          });
        };
        requestAnimationFrame(step);
      })
  );
}

/** Wait for two frames and a short idle period, so that earlier work does not leak into a measurement. */
export async function settle(page: Page, idleMs = 150): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await page.waitForTimeout(idleMs);
}

/**
 * Run one operation under a Chrome trace and the CDP Performance domain.
 * Durations from CDP are in seconds; the sample stores milliseconds.
 * `otherTasks` receives the largest kinds of work that the breakdown does not name.
 */
export async function measure(
  browser: Browser,
  page: Page,
  operation: () => Promise<void>,
  otherTasks?: { name: string; ms: number }[]
): Promise<Sample> {
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  await page.evaluate(() => window.__layoutsBench?.resetCounters());
  const before = await readCdpMetrics(session);
  await browser.startTracing(page, { categories: TRACE_CATEGORIES });
  await operation();
  const trace = await browser.stopTracing();
  const after = await readCdpMetrics(session);
  // Self-test pages have no layout and no content counters.
  const content = (await page.evaluate(() =>
    window.__layoutsBench?.counters()
  )) ?? { renders: 0, resizeCallbacks: 0 };
  await session.detach();

  const delta = (name: CdpMetricName, scale = 1): number =>
    (after[name] - before[name]) * scale;
  const analysis = analyzeTrace(trace.toString());
  otherTasks?.splice(0, otherTasks.length, ...analysis.otherTasks);
  return {
    ...analysis.summary,
    cdpLayoutCount: delta('LayoutCount'),
    cdpRecalcStyleCount: delta('RecalcStyleCount'),
    cdpLayoutMs: delta('LayoutDuration', 1000),
    cdpRecalcStyleMs: delta('RecalcStyleDuration', 1000),
    cdpScriptMs: delta('ScriptDuration', 1000),
    cdpTaskMs: delta('TaskDuration', 1000),
    contentRenders: content.renders,
    contentResizeCallbacks: content.resizeCallbacks,
  };
}

/**
 * Where an operation's style and layout work happens: the elements that it
 * marks for style or layout in each pane, and the compositing layers after it.
 * One extra run with invalidation tracking gives these values, so the tracking
 * does not slow the timed runs.
 */
export interface Attribution {
  /** The pane that the operation changes, or null when it changes several. */
  target: string | null;
  layoutInvalidations: number;
  /** Elements marked for layout in panes other than the target, pane hosts included. */
  layoutInvalidationsOutsideTarget: number;
  /**
   * Elements inside panes other than the target (header controls and content)
   * marked for layout. A pane host that a zoom hides or shows does not count.
   */
  innerLayoutInvalidationsOutsideTarget: number;
  /** Panes other than the target with any element marked for layout. */
  layoutInvalidatedPanes: number;
  styleInvalidations: number;
  styleInvalidationsOutsideTarget: number;
  styleInvalidatedPanes: number;
  /** Elements that the operation removed before the run could find their pane. */
  unresolvedInvalidations: number;
  layers: number;
  drawingLayers: number;
  peakLayers: number;
  /** Invalidated elements of each pane: layout, then style. */
  panes: Record<string, [number, number]>;
  /** The most common layout invalidations outside the target: `reason: node` and a count. */
  outsideTarget: Record<string, number>;
}

// Find the pane of a node, across shadow roots, as `pane` for a pane host
// and `pane inner` for a node inside one.
const PANE_OF_NODE = `function () {
  let node = this;
  let inner = false;
  while (node) {
    if (node.nodeType === 1 && node.hasAttribute('data-layout-pane'))
      return node.getAttribute('data-layout-pane') + (inner ? ' inner' : '');
    node = node.parentNode;
    if (node && node.nodeType === 11) node = node.host;
    inner = true;
  }
  return '';
}`;

// A run looks up at most this many nodes, in batches, so that an operation
// that removes a whole pane of content does not stall the run.
const MAX_RESOLVED_NODES = 5000;
const RESOLVE_BATCH = 100;

/**
 * The pane of each node, by the DOM node ID that trace events give, or null
 * for a node that the operation removed. `DOM.resolveNode` takes the backend
 * ID directly, so the run does not push the document to the client.
 */
export async function panesOfNodes(
  session: CDPSession,
  ids: readonly number[]
): Promise<Map<number, string | null>> {
  const panes = new Map<number, string | null>();
  const lookups = ids.slice(0, MAX_RESOLVED_NODES);
  for (let start = 0; start < lookups.length; start += RESOLVE_BATCH) {
    await Promise.all(
      lookups.slice(start, start + RESOLVE_BATCH).map(async (backendNodeId) => {
        try {
          const { object } = await session.send('DOM.resolveNode', {
            backendNodeId,
          });
          const { result } = await session.send('Runtime.callFunctionOn', {
            objectId: object.objectId,
            functionDeclaration: PANE_OF_NODE,
            returnByValue: true,
          });
          panes.set(backendNodeId, String(result.value ?? ''));
        } catch {
          panes.set(backendNodeId, null);
        }
      })
    );
  }
  return panes;
}

/** Run one operation with invalidation tracking and layer events, and attribute its work to panes. */
export async function attribute(
  browser: Browser,
  page: Page,
  operation: () => Promise<void>,
  target: string | null
): Promise<Attribution> {
  const session = await page.context().newCDPSession(page);
  await session.send('DOM.enable');
  await session.send('LayerTree.enable');
  let layers: { drawsContent: boolean }[] = [];
  let peakLayers = 0;
  session.on('LayerTree.layerTreeDidChange', (event) => {
    if (event.layers === undefined) return;
    layers = event.layers;
    peakLayers = Math.max(peakLayers, layers.length);
  });
  await browser.startTracing(page, { categories: ATTRIBUTION_CATEGORIES });
  await operation();
  const trace = await browser.stopTracing();
  const { invalidations } = analyzeTrace(trace.toString());
  const panes = await panesOfNodes(session, [
    ...new Set(invalidations.map(({ nodeId }) => nodeId)),
  ]);
  await session.detach();

  const counts: Record<string, [number, number]> = {};
  const outside = new Map<string, number>();
  let innerOutside = 0;
  const seen = new Set<string>();
  let unresolved = 0;
  for (const { kind, nodeId, nodeName, reason } of invalidations) {
    // Count each element once for each kind of invalidation.
    const key = `${kind}:${nodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const found = panes.get(nodeId);
    if (found === null || found === undefined) {
      unresolved++;
      continue;
    }
    // Elements outside every pane, such as separators, belong to the layout.
    if (found === '') continue;
    const [pane, inner] = found.split(' ');
    if (kind === 'layout' && pane !== target && inner !== undefined)
      innerOutside++;
    counts[pane] ??= [0, 0];
    counts[pane][kind === 'layout' ? 0 : 1]++;
    if (kind === 'layout' && pane !== target) {
      // Name the element without its pane-specific ID, so panes group.
      const name = `${reason}: ${nodeName.replace(/ id='[^']*'/, '').slice(0, 80)}`;
      outside.set(name, (outside.get(name) ?? 0) + 1);
    }
  }
  const entries = Object.entries(counts);
  const sum = (index: 0 | 1, outside: boolean): number =>
    entries
      .filter(([pane]) => !outside || pane !== target)
      .reduce((total, [, value]) => total + value[index], 0);
  const touched = (index: 0 | 1): number =>
    entries.filter(([pane, value]) => pane !== target && value[index] > 0)
      .length;
  return {
    target,
    layoutInvalidations: sum(0, false),
    layoutInvalidationsOutsideTarget: sum(0, true),
    innerLayoutInvalidationsOutsideTarget: innerOutside,
    layoutInvalidatedPanes: touched(0),
    styleInvalidations: sum(1, false),
    styleInvalidationsOutsideTarget: sum(1, true),
    styleInvalidatedPanes: touched(1),
    unresolvedInvalidations: unresolved,
    layers: layers.length,
    drawingLayers: layers.filter(({ drawsContent }) => drawsContent).length,
    peakLayers,
    panes: counts,
    outsideTarget: Object.fromEntries(
      [...outside].sort((a, b) => b[1] - a[1]).slice(0, 8)
    ),
  };
}
