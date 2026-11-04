import type { Page } from '@playwright/test';

export type ContentWeight = 'light' | 'heavy' | 'real';

export interface Params {
  panes: number;
  content: ContentWeight;
  /** The frame interval of the display, from `probeDisplay`. */
  frameMs: number;
}

interface Point {
  x: number;
  y: number;
  /** Where a drag ends along x, for a scenario that drags. */
  toX?: number;
}

/**
 * One user operation on the layout. `setup` runs before the trace starts;
 * `run` is the traced operation and includes the time the layout needs to settle.
 */
export interface Scenario {
  id: string;
  description: string;
  /** Pointer moves or repeated updates in one run; per-step metrics divide by this. */
  steps?: number;
  /**
   * The pane whose content the operation may change. Attribution counts work
   * in other panes as work outside the target. Omit it when the operation
   * resizes several panes.
   */
  target?: string;
  setup?(page: Page, params: Params): Promise<Point | undefined>;
  run(page: Page, params: Params, point: Point | undefined): Promise<void>;
}

// The prototype's discrete animations take 240 ms. Wait longer, so that the trace holds the last frame.
const ANIMATION_SETTLE_MS = 450;
const IDLE_SETTLE_MS = 150;
const RESIZE_STEPS = 16;
const TAB_DRAG_STEPS = 16;
const APPEND_STEPS = 10;
// The fourth pane holds an agent chat in heavy content, so an append adds a message.
const APPEND_PANE = 'p3';

async function center(page: Page, selector: string): Promise<Point> {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`Missing element: ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Start an operation in a page task, not inside `page.evaluate`: the CDP
// Performance domain counts script inside `page.evaluate` as DevTools time.
async function inPageTask(
  page: Page,
  operation: string,
  arg?: unknown
): Promise<void> {
  await page.evaluate(
    ({ operation, arg }) => {
      setTimeout(() => {
        const bench = window.__layoutsBench;
        if (operation === 'split') {
          bench.store.split(
            'p0',
            { type: 'pane', id: 'added', minWidth: 48, minHeight: 48 },
            'right'
          );
        } else if (operation === 'move') {
          bench.store.move('p0', String(arg), 'left');
        } else if (operation === 'zoom-busy') {
          bench.store.toggleZoom('p0');
          setTimeout(() => bench.busy(200), 16);
        } else if (operation === 'hide') {
          bench.store.setHidden('p1', true);
        } else if (operation === 'collapse') {
          bench.store.setCollapsed('p1', true);
        } else if (operation === 'overlay') {
          const [overlay, open] = arg as ['modal' | 'drawer', boolean];
          bench.setOverlay(overlay, open);
        }
      }, 0);
    },
    { operation, arg }
  );
}

// Real components finish async work after their first render. A tab that a
// setup adds waits for it, as the run does for the first page (see the bench).
const NEW_REAL_TAB_SETTLE_MS = 1500;

/**
 * Add a tab beside a pane, so that the pane is in a stack and the new tab
 * shows. The new tab gets the content kind that follows the last pane.
 */
async function addTab(
  page: Page,
  params: Params,
  target: string,
  id: string
): Promise<void> {
  await page.evaluate(
    ({ target, id }) =>
      window.__layoutsBench.store.addTab(target, {
        type: 'pane',
        id,
        minWidth: 48,
        minHeight: 48,
      }),
    { target, id }
  );
  await page.waitForTimeout(
    params.content === 'real' ? NEW_REAL_TAB_SETTLE_MS : ANIMATION_SETTLE_MS
  );
}

/**
 * Mount the fixture's overlays before the trace, and open one of them when
 * the scenario closes it. Their first render is then not in the trace.
 */
async function prepareOverlay(
  page: Page,
  open?: 'modal' | 'drawer'
): Promise<undefined> {
  await page.evaluate(() => window.__layoutsBench.mountOverlays());
  if (open !== undefined) {
    await page.evaluate(
      (overlay) => window.__layoutsBench.setOverlay(overlay, true),
      open
    );
    await page.waitForTimeout(ANIMATION_SETTLE_MS);
  }
  return undefined;
}

// An open or a close of each overlay, in a page task.
function overlayScenario(overlay: 'modal' | 'drawer', open: boolean): Scenario {
  const name =
    overlay === 'modal'
      ? 'a modal over the workspace'
      : 'a drawer from the right edge of the workspace';
  return {
    id: `${overlay}-${open ? 'open' : 'close'}`,
    description: `${open ? 'Open' : 'Close'} ${name}.`,
    setup: (page) => prepareOverlay(page, open ? undefined : overlay),
    async run(page) {
      await inPageTask(page, 'overlay', [overlay, open]);
      await page.waitForTimeout(ANIMATION_SETTLE_MS);
    },
  };
}

export async function zoomFirstPane(page: Page): Promise<void> {
  await page.evaluate(() => window.__layoutsBench.store.toggleZoom('p0'));
  await page.waitForTimeout(ANIMATION_SETTLE_MS);
}

// Append to a pane once per frame, as streaming terminal output or an agent
// reply does. Each append runs in a frame callback of the page.
async function appendEachFrame(page: Page, id: string): Promise<void> {
  await page.evaluate(
    ({ id, steps }) => {
      let step = 0;
      const next = (): void => {
        window.__layoutsBench.append(id);
        if (++step < steps) requestAnimationFrame(next);
      };
      setTimeout(() => requestAnimationFrame(next), 0);
    },
    { id, steps: APPEND_STEPS }
  );
  await page.waitForTimeout(IDLE_SETTLE_MS + APPEND_STEPS * 20);
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'idle',
    description:
      'Do nothing for the settle time of an animation. This run shows the cost of the harness itself.',
    async run(page) {
      await page.waitForTimeout(ANIMATION_SETTLE_MS);
    },
  },
  {
    id: 'zoom',
    description: 'Click the zoom button of the first pane.',
    target: 'p0',
    setup: (page) =>
      center(page, '[data-layout-pane="p0"] button[aria-pressed]'),
    async run(page, _params, point) {
      await page.mouse.click(point!.x, point!.y);
      await page.waitForTimeout(ANIMATION_SETTLE_MS);
    },
  },
  {
    id: 'restore',
    description: 'Click the restore button of the zoomed first pane.',
    target: 'p0',
    async setup(page) {
      await zoomFirstPane(page);
      return center(page, '[data-layout-pane="p0"] button[aria-pressed]');
    },
    async run(page, _params, point) {
      await page.mouse.click(point!.x, point!.y);
      await page.waitForTimeout(ANIMATION_SETTLE_MS);
    },
  },
  {
    id: 'zoom-busy',
    description:
      'Zoom the first pane, then block the main thread for 200 ms during the animation.',
    target: 'p0',
    async run(page) {
      await inPageTask(page, 'zoom-busy');
      await page.waitForTimeout(ANIMATION_SETTLE_MS + 200);
    },
  },
  {
    id: 'focus',
    description: 'Click the content of the second pane to move the focus.',
    target: 'p1',
    setup: (page) =>
      center(page, '[data-layout-pane="p1"] .pierre-layout-content'),
    async run(page, _params, point) {
      await page.mouse.click(point!.x, point!.y);
      await page.waitForTimeout(IDLE_SETTLE_MS);
    },
  },
  {
    id: 'resize',
    description: `Drag the root separator 160 px in ${RESIZE_STEPS} pointer moves, one per frame.`,
    steps: RESIZE_STEPS,
    setup: (page) => center(page, '.pierre-layout-separator'),
    async run(page, params, point) {
      await page.mouse.move(point!.x, point!.y);
      await page.mouse.down();
      // One move per frame interval: Playwright's `steps` sends moves faster than
      // frames, and Chromium then coalesces them.
      for (let step = 1; step <= RESIZE_STEPS; step++) {
        await page.mouse.move(point!.x + (160 * step) / RESIZE_STEPS, point!.y);
        await page.waitForTimeout(params.frameMs);
      }
      await page.mouse.up();
      await page.waitForTimeout(IDLE_SETTLE_MS);
    },
  },
  {
    id: 'split',
    description: 'Add a pane to the right of the first pane.',
    async run(page) {
      await inPageTask(page, 'split');
      await page.waitForTimeout(ANIMATION_SETTLE_MS);
    },
  },
  {
    id: 'close',
    description: 'Click the close button of the second pane.',
    setup: (page) =>
      center(page, '[data-layout-pane="p1"] button[aria-label^="Close"]'),
    async run(page, _params, point) {
      await page.mouse.click(point!.x, point!.y);
      await page.waitForTimeout(ANIMATION_SETTLE_MS);
    },
  },
  {
    id: 'move',
    description: 'Move the first pane to the left of the last pane.',
    async run(page, params) {
      await inPageTask(page, 'move', `p${params.panes - 1}`);
      await page.waitForTimeout(ANIMATION_SETTLE_MS);
    },
  },
  {
    id: 'append',
    description: `Append a message to the agent chat pane once per frame, ${APPEND_STEPS} times.`,
    steps: APPEND_STEPS,
    target: APPEND_PANE,
    run: (page) => appendEachFrame(page, APPEND_PANE),
  },
  {
    id: 'hidden-append',
    description: `Zoom the first pane, then append a message to the covered agent chat pane ${APPEND_STEPS} times.`,
    steps: APPEND_STEPS,
    target: APPEND_PANE,
    async setup(page) {
      await zoomFirstPane(page);
      return undefined;
    },
    run: (page) => appendEachFrame(page, APPEND_PANE),
  },
  {
    id: 'hide',
    description:
      'Hide the second pane with store.setHidden. It keeps its content mounted.',
    async run(page) {
      await inPageTask(page, 'hide');
      await page.waitForTimeout(ANIMATION_SETTLE_MS);
    },
  },
  {
    id: 'collapse',
    description:
      'Collapse the second pane to its header with store.setCollapsed. Its content stops rendering.',
    async run(page) {
      await inPageTask(page, 'collapse');
      await page.waitForTimeout(ANIMATION_SETTLE_MS);
    },
  },
  {
    id: 'tab-switch',
    description:
      'Add a tab beside the second pane, then click the tab of the second pane to show it again.',
    target: 'p1',
    async setup(page, params) {
      await addTab(page, params, 'p1', 't1');
      return center(page, '[data-layout-pane="t1"] [data-layout-tab="p1"]');
    },
    async run(page, _params, point) {
      await page.mouse.click(point!.x, point!.y);
      await page.waitForTimeout(IDLE_SETTLE_MS);
    },
  },
  {
    id: 'tab-drag',
    description: `Add a tab beside the second pane, then drag the new tab before the tab of the second pane in ${TAB_DRAG_STEPS} pointer moves, one per frame, and drop it.`,
    steps: TAB_DRAG_STEPS,
    target: 't1',
    async setup(page, params) {
      await addTab(page, params, 'p1', 't1');
      const from = await center(
        page,
        '[data-layout-pane="t1"] [data-layout-tab="t1"]'
      );
      const to = await page
        .locator('[data-layout-pane="t1"] [data-layout-tab="p1"]')
        .boundingBox();
      if (to === null) throw new Error('Missing tab');
      return { ...from, toX: to.x + 4 };
    },
    async run(page, params, point) {
      const { x, y, toX = x } = point!;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let step = 1; step <= TAB_DRAG_STEPS; step++) {
        await page.mouse.move(x + ((toX - x) * step) / TAB_DRAG_STEPS, y);
        await page.waitForTimeout(params.frameMs);
      }
      await page.mouse.up();
      await page.waitForTimeout(IDLE_SETTLE_MS);
    },
  },
  {
    id: 'hidden-tab-append',
    description: `Add a tab beside the agent chat pane, then append a message to the chat, which does not show, ${APPEND_STEPS} times.`,
    steps: APPEND_STEPS,
    target: APPEND_PANE,
    async setup(page, params) {
      await addTab(page, params, APPEND_PANE, 't3');
      return undefined;
    },
    run: (page) => appendEachFrame(page, APPEND_PANE),
  },
  {
    id: 'container-resize',
    description: 'Narrow the viewport from 1440 px to 1200 px.',
    async run(page) {
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.waitForTimeout(IDLE_SETTLE_MS);
    },
  },
  overlayScenario('modal', true),
  overlayScenario('modal', false),
  overlayScenario('drawer', true),
  overlayScenario('drawer', false),
];

/** Operations in each half of the repeat scenario. */
export const REPEAT_CYCLES = 20;

/**
 * The repeat scenario: zoom and restore the first pane, then hide and show the
 * second pane with `store.setHidden`, `cycles` times each. An app runs for
 * hours, so these operations must not grow memory.
 */
export async function repeatZoomAndHide(
  page: Page,
  cycles: number
): Promise<void> {
  for (let cycle = 0; cycle < cycles; cycle++) {
    for (let step = 0; step < 2; step++) {
      await page.evaluate(() => window.__layoutsBench.store.toggleZoom('p0'));
      await page.waitForTimeout(ANIMATION_SETTLE_MS);
    }
  }
  for (let cycle = 0; cycle < cycles; cycle++) {
    for (const hidden of [true, false]) {
      await page.evaluate(
        (value) => window.__layoutsBench.store.setHidden('p1', value),
        hidden
      );
      await page.waitForTimeout(ANIMATION_SETTLE_MS);
    }
  }
}

/** Hide every pane but the first with `store.setHidden`. */
export async function hideOtherPanes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const bench = window.__layoutsBench;
    for (const id of bench.paneIds.slice(1)) bench.store.setHidden(id, true);
  });
  await page.waitForTimeout(ANIMATION_SETTLE_MS);
}
