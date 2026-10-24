import type { CDPSession, Page } from '@playwright/test';

import { panesOfNodes } from './measure';
import { type AllocatorDump, rendererPid, type TraceEvent } from './trace';

/** The memory of one pane: its compositor layers, an estimate of their raster memory, and its DOM. */
export interface PaneMemory {
  layers: number;
  drawingLayers: number;
  /**
   * The area of the pane's drawing layers inside the pane and the viewport,
   * in the compositor's pixels, times 4 bytes.
   */
  estimatedRasterMb: number;
  /** Nodes in the pane host, also in open shadow roots. */
  domNodes: number;
}

/**
 * The memory of the page after an operation settles. Memory-infra dumps give
 * the raster tiles and the process totals, the CDP Memory and Runtime domains
 * give the DOM and the JS heap after a forced garbage collection, and the
 * LayerTree domain gives the layers for the estimate of each pane.
 */
export interface MemorySnapshot {
  /** Raster tiles that the page's compositor uses (`cc/tile_memory` less its unused resources). */
  tileMemoryMb: number;
  /** The part of `tileMemoryMb` in visible tiles (priority NOW). The rest is prepaint. */
  tileMemoryVisibleMb: number;
  /**
   * Raster resources that no tile used right after the operation. Chromium
   * keeps them for reuse for about 5 s; the run waits for them to expire
   * before it reads the dump values.
   */
  tileMemoryUnusedMb: number;
  /** The private footprint of the page's renderer process. */
  rendererMb: number;
  /** The private footprint of the GPU process, which holds the raster tiles. */
  gpuMb: number;
  v8Mb: number;
  blinkGcMb: number;
  partitionAllocMb: number;
  mallocMb: number;
  /** The used JS heap of the page. */
  jsHeapMb: number;
  domNodes: number;
  jsEventListeners: number;
  layers: number;
  drawingLayers: number;
  /** The sum of the estimates of all drawing layers, in panes and outside them. */
  estimatedRasterMb: number;
  /** Each pane's layers, estimate, and DOM nodes. */
  panes: Record<string, PaneMemory>;
}

const MB = 2 ** 20;
const mb = (bytes: number): number => Number((bytes / MB).toFixed(3));

// Chromium keeps raster resources that no tile uses for about 5 s. The run
// waits at most this long for them to expire, and checks this often. A few
// small resources can stay longer, so the wait ends below this size.
const POOL_SETTLE_MS = 8000;
const POOL_POLL_MS = 500;
const POOL_UNUSED_LIMIT_BYTES = 2 ** 20;
const LAYER_TIMEOUT_MS = 5000;

interface ProcessMemory {
  /** Private footprint in bytes. */
  footprint: number;
  allocators: Record<string, AllocatorDump>;
}

// A scalar attribute of an allocator: memory-infra writes it as a hexadecimal string.
function scalar(dump: AllocatorDump | undefined, name: string): number {
  const attr = dump?.attrs?.[name];
  return attr?.type === 'scalar' ? Number.parseInt(attr.value, 16) : 0;
}

async function readStream(
  session: CDPSession,
  handle: string
): Promise<string> {
  const chunks: string[] = [];
  for (;;) {
    const { data, eof, base64Encoded } = await session.send('IO.read', {
      handle,
      size: 1 << 22,
    });
    chunks.push(
      base64Encoded === true ? Buffer.from(data, 'base64').toString() : data
    );
    if (eof) break;
  }
  await session.send('IO.close', { handle });
  return chunks.join('');
}

/**
 * Request one memory-infra dump of every process, in a trace of its own. A
 * page session starts the trace, so that the trace names the page's renderer.
 * A `detailed` dump forces a garbage collection first and lists each raster
 * tile; a `light` dump is enough for the resource pool.
 */
async function dumpMemory(
  page: Page,
  level: 'light' | 'detailed'
): Promise<{ renderer: ProcessMemory; gpu: ProcessMemory | undefined }> {
  const session = await page.context().newCDPSession(page);
  const complete = new Promise<string | undefined>((resolve) =>
    session.once('Tracing.tracingComplete', ({ stream }) => resolve(stream))
  );
  await session.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    traceConfig: {
      // The timeline categories write `TracingStartedInBrowser`, which names the page's renderer.
      includedCategories: [
        'disabled-by-default-memory-infra',
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
      ],
      excludedCategories: ['*'],
      // A configuration with no triggers turns off periodic dumps.
      memoryDumpConfig: {},
    },
  });
  const { success } = await session.send('Tracing.requestMemoryDump', {
    deterministic: level === 'detailed',
    levelOfDetail: level,
  });
  await session.send('Tracing.end');
  const stream = await complete;
  if (stream === undefined) throw new Error('The memory trace has no stream');
  const text = await readStream(session, stream);
  await session.detach();
  if (!success) throw new Error('Chromium did not complete the memory dump');

  const parsed = JSON.parse(text) as
    | { traceEvents: TraceEvent[] }
    | TraceEvent[];
  const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
  const pid = rendererPid(events);
  const gpuPid = events.find(
    (event) =>
      event.ph === 'M' &&
      event.name === 'process_name' &&
      event.args?.name === 'GPU Process'
  )?.pid;
  // A process writes its totals and its allocators in separate events.
  const processes = new Map<number, ProcessMemory>();
  for (const event of events) {
    const dumps = event.args?.dumps;
    if (event.ph !== 'v' || dumps === undefined) continue;
    const process = processes.get(event.pid) ?? {
      footprint: 0,
      allocators: {},
    };
    const footprint = dumps.process_totals?.private_footprint_bytes;
    if (footprint !== undefined)
      process.footprint = Number.parseInt(footprint, 16);
    Object.assign(process.allocators, dumps.allocators);
    processes.set(event.pid, process);
  }
  const renderer = pid === undefined ? undefined : processes.get(pid);
  if (renderer === undefined)
    throw new Error('The memory dump has no data for the page renderer');
  return {
    renderer,
    gpu: gpuPid === undefined ? undefined : processes.get(gpuPid),
  };
}

/**
 * The raster resource pool of the page's compositor. Each resource under
 * `cc/tile_memory` has a size, and a `free_size` or a `busy_size` when no tile
 * uses it (busy: the GPU can still read it).
 */
function rasterPool(allocators: Record<string, AllocatorDump>): {
  usedBytes: number;
  unusedBytes: number;
} {
  let total = 0;
  let unused = 0;
  for (const [name, dump] of Object.entries(allocators)) {
    if (!/^cc\/tile_memory\/.*resource_\d+$/.test(name)) continue;
    total += scalar(dump, 'size');
    unused += scalar(dump, 'free_size') + scalar(dump, 'busy_size');
  }
  return { usedBytes: total - unused, unusedBytes: unused };
}

// The tiles that the tile manager rasterizes for the visible area. Only a
// detailed dump lists tiles.
function visibleTileBytes(allocators: Record<string, AllocatorDump>): number {
  let bytes = 0;
  for (const [name, dump] of Object.entries(allocators))
    if (
      /^cc\/tile_manager_\d+\/tile_\d+$/.test(name) &&
      dump.attrs?.priority?.value === 'NOW'
    )
      bytes += scalar(dump, 'gpu_memory');
  return bytes;
}

// The fields of a `LayerTree.Layer` that the estimate reads.
interface Layer {
  backendNodeId?: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  /** The screen transform, a column-major 4x4 matrix. */
  transform?: number[];
  drawsContent: boolean;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The compositor layers of the page now. Chromium sends the list of layers
 * only when it changes, and can send an earlier list late. So the run adds a
 * composited 1 px marker, waits for a list that holds the marker's layer,
 * removes the marker, and keeps the first list after that without it.
 */
async function currentLayers(session: CDPSession): Promise<Layer[]> {
  let latest: Layer[] = [];
  let check: (() => void) | undefined;
  const listener = (event: { layers?: Layer[] }): void => {
    if (event.layers === undefined) return;
    latest = event.layers;
    check?.();
  };
  const waitFor = (test: (layers: Layer[]) => boolean): Promise<Layer[]> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        check = undefined;
        reject(new Error('Chromium sent no list of layers'));
      }, LAYER_TIMEOUT_MS);
      check = () => {
        if (!test(latest)) return;
        clearTimeout(timer);
        check = undefined;
        resolve(latest);
      };
      check();
    });
  session.on('LayerTree.layerTreeDidChange', listener);
  await session.send('LayerTree.enable');
  const { result } = await session.send('Runtime.evaluate', {
    expression: `(() => {
      const marker = document.createElement('div');
      marker.style.cssText = 'position: fixed; top: 0; left: 0; width: 1px; height: 1px; will-change: transform; background: rgb(0 0 0 / 1%); pointer-events: none';
      document.body.append(marker);
      return marker;
    })()`,
  });
  if (result.objectId === undefined)
    throw new Error('The layer marker has no object');
  const { node } = await session.send('DOM.describeNode', {
    objectId: result.objectId,
  });
  const hasMarker = (layers: Layer[]): boolean =>
    layers.some(({ backendNodeId }) => backendNodeId === node.backendNodeId);
  await waitFor(hasMarker);
  await session.send('Runtime.callFunctionOn', {
    objectId: result.objectId,
    functionDeclaration: 'function () { this.remove(); }',
  });
  const layers = await waitFor((list) => !hasMarker(list));
  session.off('LayerTree.layerTreeDidChange', listener);
  await session.send('LayerTree.disable');
  return layers;
}

// The box of a layer in the viewport, in the compositor's pixels: its screen
// transform applied to its bounds. Layers here have 2D transforms.
function layerRect(layer: Layer): Rect {
  const t = layer.transform ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const corners = [
    [layer.offsetX, layer.offsetY],
    [layer.offsetX + layer.width, layer.offsetY],
    [layer.offsetX, layer.offsetY + layer.height],
    [layer.offsetX + layer.width, layer.offsetY + layer.height],
  ];
  const xs = corners.map(([x, y]) => t[0] * x + t[4] * y + t[12]);
  const ys = corners.map(([x, y]) => t[1] * x + t[5] * y + t[13]);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function intersect(a: Rect, b: Rect): Rect {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

function area(rect: Rect): number {
  return (
    Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top)
  );
}

/**
 * Each pane host's box in CSS pixels and its number of nodes, also in open
 * shadow roots. Pane hosts are the elements with `data-layout-pane`.
 */
function readPanes(
  page: Page
): Promise<({ id: string; nodes: number } & Rect)[]> {
  return page.evaluate(() => {
    const count = (root: Node): number => {
      let nodes = 0;
      const stack = [root];
      for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
        nodes++;
        if (node instanceof Element && node.shadowRoot !== null)
          stack.push(node.shadowRoot);
        for (
          let child = node.firstChild;
          child !== null;
          child = child.nextSibling
        )
          stack.push(child);
      }
      return nodes;
    };
    return [
      ...document.querySelectorAll<HTMLElement>('[data-layout-pane]'),
    ].map((host) => {
      const { left, top, right, bottom } = host.getBoundingClientRect();
      return {
        id: host.dataset.layoutPane ?? '',
        nodes: count(host),
        left,
        top,
        right,
        bottom,
      };
    });
  });
}

/**
 * Measure the memory of the page as it is now, after an operation: wait until
 * Chromium releases the raster resources that the operation stopped using,
 * then read the memory dump, the DOM and JS heap counters, and the layers.
 */
export async function measureMemory(page: Page): Promise<MemorySnapshot> {
  const paneBoxes = await readPanes(page);
  const session = await page.context().newCDPSession(page);
  // Two collections, so that objects that the first one finalizes are also gone.
  await session.send('HeapProfiler.enable');
  await session.send('HeapProfiler.collectGarbage');
  await session.send('HeapProfiler.collectGarbage');
  await session.send('HeapProfiler.disable');
  const dom = await session.send('Memory.getDOMCounters');
  const heap = await session.send('Runtime.getHeapUsage');

  // The compositor can raster at a larger scale than CSS pixels: the layout
  // viewport in its pixels over the same viewport in CSS pixels.
  const metrics = await session.send('Page.getLayoutMetrics');
  const scale =
    metrics.layoutViewport.clientWidth / metrics.cssLayoutViewport.clientWidth;
  const viewport: Rect = {
    left: 0,
    top: 0,
    right: metrics.layoutViewport.clientWidth,
    bottom: metrics.layoutViewport.clientHeight,
  };
  // The layers come first: the frames of the layer marker also make the
  // compositor release the tiles that it no longer needs, which a page with
  // no new frame keeps after an animation.
  await session.send('DOM.enable');
  const layers = await currentLayers(session);
  const owners = await panesOfNodes(
    session,
    layers.flatMap(({ backendNodeId }) =>
      backendNodeId === undefined ? [] : [backendNodeId]
    )
  );
  await session.detach();

  let dump = await dumpMemory(page, 'light');
  const unusedAfterOperation = rasterPool(dump.renderer.allocators).unusedBytes;
  const deadline = Date.now() + POOL_SETTLE_MS;
  while (
    rasterPool(dump.renderer.allocators).unusedBytes >
      POOL_UNUSED_LIMIT_BYTES &&
    Date.now() < deadline
  ) {
    await page.waitForTimeout(POOL_POLL_MS);
    dump = await dumpMemory(page, 'light');
  }
  dump = await dumpMemory(page, 'detailed');
  const { allocators } = dump.renderer;

  const panes: Record<string, PaneMemory> = {};
  const clips = new Map<string, Rect>();
  for (const { id, nodes, ...box } of paneBoxes) {
    panes[id] = {
      layers: 0,
      drawingLayers: 0,
      estimatedRasterMb: 0,
      domNodes: nodes,
    };
    // A pane host clips its content (`overflow: clip`), so the pane's box bounds each of its layers.
    clips.set(
      id,
      intersect(viewport, {
        left: box.left * scale,
        top: box.top * scale,
        right: box.right * scale,
        bottom: box.bottom * scale,
      })
    );
  }
  let estimatedBytes = 0;
  for (const layer of layers) {
    const owner =
      layer.backendNodeId === undefined
        ? undefined
        : owners.get(layer.backendNodeId);
    // `pane` or `pane inner`; layers outside every pane have no pane.
    const pane = owner?.split(' ')[0] ?? '';
    const clip = clips.get(pane) ?? viewport;
    const bytes = layer.drawsContent
      ? area(intersect(layerRect(layer), clip)) * 4
      : 0;
    estimatedBytes += bytes;
    const memory = panes[pane];
    if (memory === undefined) continue;
    memory.layers++;
    if (layer.drawsContent) memory.drawingLayers++;
    memory.estimatedRasterMb += bytes;
  }
  for (const memory of Object.values(panes))
    memory.estimatedRasterMb = mb(memory.estimatedRasterMb);

  const allocator = (name: string): number =>
    mb(scalar(allocators[name], 'size'));
  return {
    tileMemoryMb: mb(rasterPool(allocators).usedBytes),
    tileMemoryVisibleMb: mb(visibleTileBytes(allocators)),
    tileMemoryUnusedMb: mb(unusedAfterOperation),
    rendererMb: mb(dump.renderer.footprint),
    gpuMb: mb(dump.gpu?.footprint ?? 0),
    v8Mb: allocator('v8'),
    blinkGcMb: allocator('blink_gc'),
    partitionAllocMb: allocator('partition_alloc'),
    mallocMb: allocator('malloc'),
    jsHeapMb: mb(heap.usedSize),
    domNodes: dom.nodes,
    jsEventListeners: dom.jsEventListeners,
    layers: layers.length,
    drawingLayers: layers.filter(({ drawsContent }) => drawsContent).length,
    estimatedRasterMb: mb(estimatedBytes),
    panes,
  };
}
