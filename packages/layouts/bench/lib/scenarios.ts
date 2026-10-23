import type { Page } from '@playwright/test';

export type ContentWeight = 'light' | 'heavy';

export interface Params {
  panes: number;
  content: ContentWeight;
}

interface Point {
  x: number;
  y: number;
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
  setup?(page: Page, params: Params): Promise<Point | undefined>;
  run(page: Page, params: Params, point: Point | undefined): Promise<void>;
}

// The prototype's discrete animations take 240 ms. Wait longer, so that the trace holds the last frame.
const ANIMATION_SETTLE_MS = 450;
const IDLE_SETTLE_MS = 150;
const RESIZE_STEPS = 16;
const APPEND_STEPS = 10;
// The fourth pane holds an agent chat in heavy content, so an append adds a message.
const APPEND_PANE = 'p3';

async function center(page: Page, selector: string): Promise<Point> {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`Missing element: ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function zoomFirstPane(page: Page): Promise<void> {
  await page.evaluate(() => window.__layoutsBench.store.toggleZoom('p0'));
  await page.waitForTimeout(ANIMATION_SETTLE_MS);
}

// Append to a pane once per frame, as streaming terminal output or an agent reply does.
async function appendEachFrame(page: Page, id: string): Promise<void> {
  await page.evaluate(
    async ({ id, steps }) => {
      for (let step = 0; step < steps; step++) {
        window.__layoutsBench.append(id);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    },
    { id, steps: APPEND_STEPS }
  );
  await page.waitForTimeout(IDLE_SETTLE_MS);
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
    async run(page) {
      await page.evaluate(() => {
        window.__layoutsBench.store.toggleZoom('p0');
        setTimeout(() => window.__layoutsBench.busy(200), 16);
      });
      await page.waitForTimeout(ANIMATION_SETTLE_MS + 200);
    },
  },
  {
    id: 'focus',
    description: 'Click the content of the second pane to move the focus.',
    setup: (page) =>
      center(page, '[data-layout-pane="p1"] .pierre-layout-content'),
    async run(page, _params, point) {
      await page.mouse.click(point!.x, point!.y);
      await page.waitForTimeout(IDLE_SETTLE_MS);
    },
  },
  {
    id: 'resize',
    description: `Drag the root separator 160 px in ${RESIZE_STEPS} pointer moves.`,
    steps: RESIZE_STEPS,
    setup: (page) => center(page, '.pierre-layout-separator'),
    async run(page, _params, point) {
      await page.mouse.move(point!.x, point!.y);
      await page.mouse.down();
      await page.mouse.move(point!.x + 160, point!.y, {
        steps: RESIZE_STEPS,
      });
      await page.mouse.up();
      await page.waitForTimeout(IDLE_SETTLE_MS);
    },
  },
  {
    id: 'split',
    description: 'Add a pane to the right of the first pane.',
    async run(page) {
      await page.evaluate(() =>
        window.__layoutsBench.store.split(
          'p0',
          { type: 'pane', id: 'added', minWidth: 48, minHeight: 48 },
          'right'
        )
      );
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
      await page.evaluate(
        (last) => window.__layoutsBench.store.move('p0', last, 'left'),
        `p${params.panes - 1}`
      );
      await page.waitForTimeout(ANIMATION_SETTLE_MS);
    },
  },
  {
    id: 'append',
    description: `Append a message to the agent chat pane once per frame, ${APPEND_STEPS} times.`,
    steps: APPEND_STEPS,
    run: (page) => appendEachFrame(page, APPEND_PANE),
  },
  {
    id: 'hidden-append',
    description: `Zoom the first pane, then append a message to the covered agent chat pane ${APPEND_STEPS} times.`,
    steps: APPEND_STEPS,
    async setup(page) {
      await zoomFirstPane(page);
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
];
