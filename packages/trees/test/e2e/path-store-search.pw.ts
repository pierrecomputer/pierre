import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __pathStoreSearchFixtureReady?: boolean;
  }
}

test.describe('path-store search proof', () => {
  test('printable-key open seeding and hide-non-matches filtering work in the visible search tree', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/path-store-search.html');
    await page.waitForFunction(
      () => window.__pathStoreSearchFixtureReady === true
    );

    const visibleTree = page.locator('file-tree-container').nth(0);
    const firstRow = visibleTree.locator(
      'button[data-type="item"][data-item-path="src/"]'
    );
    await firstRow.click();
    await page.keyboard.press('w');

    const searchInput = visibleTree.locator(
      'input[data-file-tree-search-input]'
    );
    await expect(searchInput).toHaveValue('w');
    await searchInput.type('orker');

    await expect(
      visibleTree.locator('button[data-item-path="src/utils/worker.ts"]')
    ).toBeVisible();
    await expect(
      visibleTree.locator('button[data-item-path="README.md"]')
    ).toHaveCount(0);
    await expect(page.locator('[data-path-store-search-log]')).toContainText(
      'visible:worker'
    );
  });

  test('search keeps input focus while ArrowDown updates the focused match', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/path-store-search.html');
    await page.waitForFunction(
      () => window.__pathStoreSearchFixtureReady === true
    );

    const visibleTree = page.locator('file-tree-container').nth(0);
    const firstRow = visibleTree.locator(
      'button[data-type="item"][data-item-path="src/"]'
    );
    await firstRow.click();
    await page.keyboard.press('w');

    const searchInput = visibleTree.locator(
      'input[data-file-tree-search-input]'
    );
    await expect(searchInput).toBeFocused();

    const initialFocusedRow = visibleTree.locator(
      'button[data-item-focused="true"]'
    );
    const initialActiveDescendant = await searchInput.getAttribute(
      'aria-activedescendant'
    );
    await expect(initialFocusedRow).toHaveCount(1);
    await expect(initialFocusedRow).toHaveAttribute(
      'id',
      initialActiveDescendant ?? ''
    );

    await page.keyboard.press('ArrowDown');

    const nextFocusedRow = visibleTree.locator(
      'button[data-item-focused="true"]'
    );
    const nextActiveDescendant = await searchInput.getAttribute(
      'aria-activedescendant'
    );
    await expect(searchInput).toBeFocused();
    await expect(nextFocusedRow).toHaveCount(1);
    await expect(nextFocusedRow).toHaveAttribute(
      'id',
      nextActiveDescendant ?? ''
    );
    expect(nextActiveDescendant).not.toBe(initialActiveDescendant);
  });

  test('escape closes visible search and restores the full tree slice', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/path-store-search.html');
    await page.waitForFunction(
      () => window.__pathStoreSearchFixtureReady === true
    );

    const visibleTree = page.locator('file-tree-container').nth(0);
    const firstRow = visibleTree.locator(
      'button[data-type="item"][data-item-path="src/"]'
    );
    await firstRow.click();
    await page.keyboard.press('w');

    const searchInput = visibleTree.locator(
      'input[data-file-tree-search-input]'
    );
    await searchInput.type('orker');
    await searchInput.press('Escape');

    await expect(searchInput).toHaveValue('');
    await expect(
      visibleTree.locator('button[data-item-path="README.md"]')
    ).toBeVisible();
    await expect(page.locator('[data-path-store-search-log]')).toContainText(
      'visible:<closed>'
    );
  });

  test('hidden-input search still works programmatically', async ({ page }) => {
    await page.goto('/test/e2e/fixtures/path-store-search.html');
    await page.waitForFunction(
      () => window.__pathStoreSearchFixtureReady === true
    );

    const hiddenTree = page.locator('file-tree-container').nth(1);
    await expect(
      hiddenTree.locator('input[data-file-tree-search-input]')
    ).toHaveCount(0);

    await page.locator('[data-hidden-search-open]').click();

    await expect(
      hiddenTree.locator('button[data-item-path="src/utils/worker.ts"]')
    ).toBeVisible();
    await expect(
      hiddenTree.locator('button[data-item-path="README.md"]')
    ).toHaveCount(0);
    await expect(page.locator('[data-path-store-search-log]')).toContainText(
      'hidden:worker'
    );
  });
});
