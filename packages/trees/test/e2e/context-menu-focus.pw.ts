import { expect, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    __fileTreeFixtureReady?: boolean;
  }
}

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/context-menu.html');
  await page.waitForFunction(() => window.__fileTreeFixtureReady === true);
}

async function waitForNextFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      })
  );
}

async function getFocusedItemId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const host = document.getElementById('context-menu-host');
    const focusedItem = host?.shadowRoot?.querySelector(
      'button[data-type="item"][data-item-focused="true"]'
    ) as HTMLButtonElement | null;
    return focusedItem?.dataset.itemId ?? null;
  });
}

test.describe('file-tree context menu focus continuity', () => {
  test('restores keyboard navigation after closing a mouse-opened context menu', async ({
    page,
  }) => {
    await openFixture(page);

    const items = page.locator('file-tree-container button[data-type="item"]');
    await expect(items.first()).toBeVisible();
    await items.first().click();

    await expect.poll(() => getFocusedItemId(page)).not.toBeNull();
    const focusedBeforeArrow = await getFocusedItemId(page);
    if (focusedBeforeArrow == null) {
      throw new Error('Expected an initial focused item before ArrowDown');
    }

    await page.keyboard.press('ArrowDown');
    await expect
      .poll(() => getFocusedItemId(page))
      .not.toBe(focusedBeforeArrow);
    await waitForNextFrame(page);
    const focusedBeforeOpen = await getFocusedItemId(page);
    expect(focusedBeforeOpen).not.toBeNull();
    if (focusedBeforeOpen == null) {
      throw new Error(
        'Expected a focused item before opening the context menu'
      );
    }

    const focusedRow = page.locator(
      `file-tree-container button[data-type="item"][data-item-id="${focusedBeforeOpen}"]`
    );
    await focusedRow.hover();

    const trigger = page.locator(
      'file-tree-container button[data-type="context-menu-trigger"][data-visible="true"]'
    );
    await expect(trigger).toBeVisible();
    await trigger.click();

    const menu = page.locator('[data-test-context-menu]');
    await expect(menu).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const deleteButton = document.querySelector(
            '[data-test-menu-delete]'
          );
          return (
            deleteButton instanceof HTMLButtonElement &&
            document.activeElement === deleteButton
          );
        })
      )
      .toBe(true);

    // While the menu is open, tree navigation should be blocked.
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => getFocusedItemId(page)).toBe(focusedBeforeOpen);

    await page.locator('[data-test-menu-delete]').click();
    await expect(menu).toHaveCount(0);

    // closeContextMenu restores focus asynchronously; wait until focus lands
    // on a concrete element before sending the next key.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const activeElement = document.activeElement;
          return (
            activeElement != null &&
            activeElement !== document.body &&
            activeElement !== document.documentElement
          );
        })
      )
      .toBe(true);
    await page.keyboard.press('ArrowDown');

    await expect.poll(() => getFocusedItemId(page)).not.toBe(focusedBeforeOpen);
  });
});
