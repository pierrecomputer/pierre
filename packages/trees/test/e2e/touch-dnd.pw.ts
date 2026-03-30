import { type CDPSession, expect, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    __fileTreeFixtureReady?: boolean;
    __lastFilesChange?: string[];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openFixture(page: Page) {
  // Enable touch emulation via CDP before navigating
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  });
  await cdp.detach();

  await page.goto('/test/e2e/fixtures/touch-dnd.html');
  await page.waitForFunction(() => window.__fileTreeFixtureReady === true);
}

/** Returns the bounding rect of a tree item button (inside shadow DOM) by its text label. */
async function getItemRect(page: Page, label: string) {
  return page.evaluate((lbl) => {
    const host = document.getElementById('touch-dnd-host');
    const root = host?.shadowRoot;
    if (root == null) return null;
    const button = root.querySelector(
      `button[data-type="item"][aria-label="${lbl}"]`
    );
    if (button == null) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, label);
}

/** Returns whether an item has the data-item-dragging attribute. */
async function isDragging(page: Page, label: string) {
  return page.evaluate((lbl) => {
    const host = document.getElementById('touch-dnd-host');
    const root = host?.shadowRoot;
    if (root == null) return false;
    const button = root.querySelector(
      `button[data-type="item"][aria-label="${lbl}"]`
    );
    return button?.hasAttribute('data-item-dragging') === true;
  }, label);
}

/** Returns whether an item has the data-item-drag-target attribute. */
async function isDragTarget(page: Page, label: string) {
  return page.evaluate((lbl) => {
    const host = document.getElementById('touch-dnd-host');
    const root = host?.shadowRoot;
    if (root == null) return false;
    const button = root.querySelector(
      `button[data-type="item"][aria-label="${lbl}"]`
    );
    return button?.hasAttribute('data-item-drag-target') === true;
  }, label);
}

/**
 * Helper to manage a CDP session for a touch gesture sequence.
 * CDP requires touchStart → touchMove → touchEnd on the same session.
 */
class TouchSession {
  cdp: CDPSession;

  constructor(cdp: CDPSession) {
    this.cdp = cdp;
  }

  static async create(page: Page): Promise<TouchSession> {
    const cdp = await page.context().newCDPSession(page);
    return new TouchSession(cdp);
  }

  async touchStart(x: number, y: number) {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: Math.round(x), y: Math.round(y) }],
      modifiers: 0,
    });
  }

  async touchMove(x: number, y: number) {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: Math.round(x), y: Math.round(y) }],
      modifiers: 0,
    });
  }

  async touchEnd() {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
      modifiers: 0,
    });
  }

  async touchCancel() {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
      modifiers: 0,
    });
  }

  async dispose() {
    await this.cdp.detach();
  }
}

/**
 * Performs a long-press-and-hold at the center of `sourceLabel`,
 * then moves to the center of `targetLabel`, then releases.
 */
async function longPressDragAndDrop(
  page: Page,
  sourceLabel: string,
  targetLabel: string
) {
  const sourceRect = await getItemRect(page, sourceLabel);
  const targetRect = await getItemRect(page, targetLabel);
  if (sourceRect == null || targetRect == null) {
    throw new Error(
      `Could not find items: source="${sourceLabel}", target="${targetLabel}"`
    );
  }

  const sx = sourceRect.x + sourceRect.width / 2;
  const sy = sourceRect.y + sourceRect.height / 2;
  const tx = targetRect.x + targetRect.width / 2;
  const ty = targetRect.y + targetRect.height / 2;

  const touch = await TouchSession.create(page);

  // Touch down on source
  await touch.touchStart(sx, sy);

  // Wait for long-press timer (400ms) + buffer
  await page.waitForTimeout(500);

  // Move to target in a few steps to simulate realistic drag
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const cx = sx + ((tx - sx) * i) / steps;
    const cy = sy + ((ty - sy) * i) / steps;
    await touch.touchMove(cx, cy);
    await page.waitForTimeout(30);
  }

  // Small pause on target to let state settle
  await page.waitForTimeout(50);

  // Release
  await touch.touchEnd();
  await touch.dispose();

  // Allow state updates to propagate
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('file-tree touch drag-and-drop', () => {
  test('long press marks item as dragging', async ({ page }) => {
    await openFixture(page);

    const rect = await getItemRect(page, 'README.md');
    expect(rect).not.toBeNull();

    const touch = await TouchSession.create(page);

    // Touch down
    await touch.touchStart(rect!.x + 20, rect!.y + 10);

    // Before long-press fires, item should NOT be dragging
    await page.waitForTimeout(200);
    expect(await isDragging(page, 'README.md')).toBe(false);

    // After long-press fires (400ms total from start)
    await page.waitForTimeout(300);
    expect(await isDragging(page, 'README.md')).toBe(true);

    // Clean up — end the touch
    await touch.touchEnd();
    await touch.dispose();
    await page.waitForTimeout(100);
  });

  test('short tap does not start drag', async ({ page }) => {
    await openFixture(page);

    const rect = await getItemRect(page, 'README.md');
    expect(rect).not.toBeNull();

    const touch = await TouchSession.create(page);

    // Quick tap: touch down then up within 200ms
    await touch.touchStart(rect!.x + 20, rect!.y + 10);
    await page.waitForTimeout(100);
    await touch.touchEnd();
    await touch.dispose();
    await page.waitForTimeout(100);

    // Should never have entered drag state
    expect(await isDragging(page, 'README.md')).toBe(false);
  });

  test('moving finger before long-press cancels drag', async ({ page }) => {
    await openFixture(page);

    const rect = await getItemRect(page, 'README.md');
    expect(rect).not.toBeNull();

    const touch = await TouchSession.create(page);

    // Touch down
    await touch.touchStart(rect!.x + 20, rect!.y + 10);
    await page.waitForTimeout(100);

    // Move finger more than 10px threshold
    await touch.touchMove(rect!.x + 40, rect!.y + 10);
    await page.waitForTimeout(400);

    // Long-press timer should have been cancelled
    expect(await isDragging(page, 'README.md')).toBe(false);

    // Clean up
    await touch.touchEnd();
    await touch.dispose();
  });

  test('dragging over folder highlights it as drop target', async ({
    page,
  }) => {
    await openFixture(page);

    const sourceRect = await getItemRect(page, 'README.md');
    const targetRect = await getItemRect(page, 'lib');
    expect(sourceRect).not.toBeNull();
    expect(targetRect).not.toBeNull();

    const touch = await TouchSession.create(page);

    // Long press on source
    await touch.touchStart(sourceRect!.x + 20, sourceRect!.y + 10);
    await page.waitForTimeout(500);
    expect(await isDragging(page, 'README.md')).toBe(true);

    // Move to target folder
    await touch.touchMove(
      targetRect!.x + targetRect!.width / 2,
      targetRect!.y + targetRect!.height / 2
    );
    await page.waitForTimeout(100);

    // Target folder should be highlighted
    expect(await isDragTarget(page, 'lib')).toBe(true);

    // Clean up — cancel
    await touch.touchCancel();
    await touch.dispose();
    await page.waitForTimeout(100);

    // After cancel, drag state should be cleared
    expect(await isDragging(page, 'README.md')).toBe(false);
    expect(await isDragTarget(page, 'lib')).toBe(false);
  });

  test('long-press drag moves file into folder', async ({ page }) => {
    await openFixture(page);

    // Perform the full drag-and-drop gesture
    await longPressDragAndDrop(page, 'README.md', 'lib');

    // Wait for files change callback to propagate
    await page.waitForTimeout(300);

    // The file list should have changed — README.md should now be under lib/
    const newFiles = await page.evaluate(() => window.__lastFilesChange);
    expect(newFiles).not.toBeNull();
    expect(newFiles).toContain('lib/README.md');
    expect(newFiles).not.toContain('README.md');
  });

  test('drag state is cleared after drop completes', async ({ page }) => {
    await openFixture(page);

    await longPressDragAndDrop(page, 'package.json', 'src');
    await page.waitForTimeout(200);

    // No items should be in dragging state after drop
    expect(await isDragging(page, 'package.json')).toBe(false);
    expect(await isDragTarget(page, 'src')).toBe(false);
  });
});
