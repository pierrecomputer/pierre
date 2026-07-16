import { expect, type Page, test } from '@playwright/test';

const CONTENT = '[data-content]';
const POPOVER = '[data-selection-action-popover]';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/selection-action.html');
  await page.waitForFunction(() => window.__selectionActionReady === true);
}

const actionClicks = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__actionClicks ?? []);

function popoverWithinHost(page: Page): Promise<boolean> {
  return page.evaluate((sel) => {
    const host = document.querySelector('diffs-container');
    const root = host?.shadowRoot;
    const popover = root?.querySelector(sel);
    if (host == null || popover == null) {
      return false;
    }
    const hostRect = host.getBoundingClientRect();
    const rect = popover.getBoundingClientRect();
    return (
      rect.left >= hostRect.left - 1 &&
      rect.top >= hostRect.top - 1 &&
      rect.right <= hostRect.right + 1 &&
      rect.bottom <= hostRect.bottom + 1
    );
  }, POPOVER);
}

// Double-click a word to make a real, mouse-driven ranged selection. The
// popover is (re)created on pointerup for enabledSelectionAction, so a mouse
// gesture is what surfaces it.
async function selectWord(page: Page): Promise<void> {
  await page.locator(CONTENT).getByText('alpha').dblclick();
}

test.describe('selection action popover', () => {
  test('appears with custom content on a ranged selection', async ({
    page,
  }) => {
    await openFixture(page);
    await selectWord(page);

    const popover = page.locator(POPOVER);
    await expect(popover).toBeVisible();
    await expect(popover.locator('[data-test-action-button]')).toBeVisible();
  });

  test('stays within the editor bounds', async ({ page }) => {
    await openFixture(page);
    await selectWord(page);

    await expect(page.locator(POPOVER)).toBeVisible();
    expect(await popoverWithinHost(page)).toBe(true);
  });

  test('clicking the action receives the selected text', async ({ page }) => {
    await openFixture(page);
    await selectWord(page);

    await expect(page.locator(POPOVER)).toBeVisible();
    await page.locator('[data-test-action-button]').click();

    await expect.poll(() => actionClicks(page)).toEqual(['alpha']);
  });
});

// Reads the popover's --popover-y-shift, which encodes the resolved side:
// '0px' means placed below the anchor, '-100%' means lifted above it.
function popoverShift(page: Page): Promise<string> {
  return page.evaluate((sel) => {
    const root = document.querySelector('diffs-container')?.shadowRoot;
    const popover = root?.querySelector(sel);
    if (!(popover instanceof HTMLElement)) {
      return '';
    }
    return popover.style.getPropertyValue('--popover-y-shift').trim();
  }, POPOVER);
}

// Drags a real mouse selection from the center of one line's identifier token to
// another's. The drag direction sets the selection direction (and thus which
// side the popover prefers): a downward drag is forward, an upward drag is
// backward, with the head landing on the drag's end line.
async function dragSelect(
  page: Page,
  fromToken: string,
  toToken: string
): Promise<void> {
  const center = async (token: string): Promise<{ x: number; y: number }> => {
    const box = await page
      .locator(CONTENT)
      .getByText(token, { exact: true })
      .first()
      .boundingBox();
    if (box == null) {
      throw new Error(`no bounding box for ${token}`);
    }
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const from = await center(fromToken);
  const to = await center(toToken);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

// The taller 16-line fixture exists so a selection's head can sit exactly on the
// first or last row: cases where the popover's preferred side would be clipped
// by [data-code]'s own `overflow-y: clip` even though the window still has room
// beyond that edge. Each case asserts the popover stays within the file
// component and, for the edge cases, that it flipped to the fitting side.
test.describe('selection action popover placement (edges)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/fixtures/selection-action-edges.html');
    await page.waitForFunction(
      () => window.__selectionActionEdgesReady === true
    );
  });

  test('forward selection mid-file places the popover below, within bounds', async ({
    page,
  }) => {
    await dragSelect(page, 'line06', 'line09');

    await expect(page.locator(POPOVER)).toBeVisible();
    expect(await popoverShift(page)).toBe('0px');
    expect(await popoverWithinHost(page)).toBe(true);
  });

  test('backward selection mid-file places the popover above, within bounds', async ({
    page,
  }) => {
    await dragSelect(page, 'line11', 'line08');

    await expect(page.locator(POPOVER)).toBeVisible();
    expect(await popoverShift(page)).toBe('-100%');
    expect(await popoverWithinHost(page)).toBe(true);
  });

  test('backward selection up to the first line flips below, within bounds', async ({
    page,
  }) => {
    await dragSelect(page, 'line05', 'line01');

    await expect(page.locator(POPOVER)).toBeVisible();
    // Preferred (above the first row) would be clipped by the code box top, so
    // it must flip below the selection's bottom edge instead of spilling out.
    expect(await popoverShift(page)).toBe('0px');
    expect(await popoverWithinHost(page)).toBe(true);
  });

  test('forward selection down to the last line flips above, within bounds', async ({
    page,
  }) => {
    await dragSelect(page, 'line12', 'line16');

    await expect(page.locator(POPOVER)).toBeVisible();
    // Preferred (below the last row) would be clipped by the code box bottom, so
    // it must flip above the selection's top edge instead of spilling out.
    expect(await popoverShift(page)).toBe('-100%');
    expect(await popoverWithinHost(page)).toBe(true);
  });

  // Selecting the whole document puts the selection's head on the last row and
  // its other edge on the first row, so neither the preferred (below) nor the
  // fallback (above) side has room — the vertical viewport clamp must still
  // keep the popover within the code box rather than letting it spill out, and
  // leave a --popover-gap inset from the clamped edge rather than sitting flush.
  test('select-all keeps the popover within bounds with an edge gap', async ({
    page,
  }) => {
    await page.locator(CONTENT).click();
    await page.keyboard.press('ControlOrMeta+a');

    await expect(page.locator(POPOVER)).toBeVisible();
    expect(await popoverWithinHost(page)).toBe(true);

    // The popover is clamped to the bottom edge here, so its bottom should sit a
    // few px above the code box bottom (the default --popover-gap is 8px).
    const bottomGap = await page.evaluate((sel) => {
      const root = document.querySelector('diffs-container')?.shadowRoot;
      const code = root?.querySelector('[data-code]');
      const popover = root?.querySelector(sel);
      if (code == null || popover == null) {
        return null;
      }
      return (
        code.getBoundingClientRect().bottom -
        popover.getBoundingClientRect().bottom
      );
    }, POPOVER);
    expect(bottomGap).not.toBeNull();
    expect(bottomGap!).toBeGreaterThanOrEqual(4);
  });
});
