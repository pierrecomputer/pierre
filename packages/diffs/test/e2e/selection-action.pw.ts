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
