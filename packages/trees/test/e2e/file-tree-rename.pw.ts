import { expect, type Locator, test } from '@playwright/test';

import { scrollUntilLocatorPresent } from './helpers/stickyScroll';

declare global {
  interface Window {
    __fileTreeRenameFixtureReady?: boolean;
  }
}

test.describe('file-tree rename proof', () => {
  const getFocusedPath = async (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const host = document.querySelectorAll('file-tree-container')[0];
      const focusedItem = host?.shadowRoot?.querySelector(
        '[data-type="item"][data-item-focused="true"]'
      ) as HTMLElement | null;
      return focusedItem?.dataset.itemPath ?? null;
    });

  const scrollUntilStickyRow = (
    tree: Locator,
    path: string
  ): Promise<Locator> =>
    scrollUntilLocatorPresent(
      tree,
      tree.locator(
        `button[data-type="item"][data-file-tree-sticky-row="true"][data-item-path="${path}"]`
      )
    );

  test('F2 starts inline rename and Enter commits the renamed path', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-rename.html');
    await page.waitForFunction(
      () => window.__fileTreeRenameFixtureReady === true
    );

    const mainTree = page.locator('file-tree-container').nth(0);
    const readmeRow = mainTree.locator(
      'button[data-type="item"][data-item-path="README.md"]'
    );
    await readmeRow.click();
    await readmeRow.press('F2');

    const renameInput = mainTree.locator('input[data-item-rename-input]');
    await expect(renameInput).toBeFocused();
    await expect(renameInput).toHaveValue('README.md');

    await renameInput.fill('RENAMED.md');
    await renameInput.press('Enter');

    const renamedRow = mainTree.locator(
      'button[data-type="item"][data-item-path="RENAMED.md"]'
    );
    await expect(renamedRow).toBeVisible();
    await expect(renamedRow).toHaveAttribute('data-item-selected', 'true');
    await expect(renamedRow).toBeFocused();
    await expect(page.locator('[data-file-tree-rename-log]')).toContainText(
      'rename:commit README.md -> RENAMED.md'
    );
  });

  test('context-menu rename closes the menu and Escape cancels the inline session', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-rename.html');
    await page.waitForFunction(
      () => window.__fileTreeRenameFixtureReady === true
    );

    const mainTree = page.locator('file-tree-container').nth(0);
    const indexRow = mainTree.locator(
      'button[data-type="item"][data-item-path="src/index.ts"]'
    );
    await indexRow.click();
    await indexRow.click({ button: 'right' });

    const menu = page.locator('[data-test-context-menu="true"]');
    await expect(menu).toBeVisible();
    await page.locator('[data-test-menu-rename="src/index.ts"]').click();

    const renameInput = mainTree.locator('input[data-item-rename-input]');
    await expect(menu).toHaveCount(0);
    await expect(renameInput).toBeFocused();
    await expect(renameInput).toHaveValue('index.ts');

    await renameInput.press('Escape');
    await expect(renameInput).toHaveCount(0);
    await expect(indexRow).toBeVisible();
  });

  test('sticky-row context-menu rename hands off focus to the canonical row input', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-rename.html');
    await page.waitForFunction(
      () => window.__fileTreeRenameFixtureReady === true
    );

    const mainTree = page.locator('file-tree-container').nth(0);
    const stickyLibRow = await scrollUntilStickyRow(mainTree, 'src/lib/');
    const canonicalLibRow = mainTree.locator(
      'button[data-type="item"][data-item-path="src/lib/"]:not([data-file-tree-sticky-row="true"])'
    );
    await expect(canonicalLibRow).toHaveCount(0);

    await stickyLibRow.hover();
    const trigger = mainTree.locator(
      'button[data-type="context-menu-trigger"][data-visible="true"]'
    );
    await expect(trigger).toBeVisible();
    await trigger.click();

    const menu = page.locator('[data-test-context-menu="true"]');
    await expect(menu).toBeVisible();
    await page.locator('[data-test-menu-rename="src/lib/"]').click();

    const renameRow = mainTree.locator(
      'div[data-type="item"][data-item-path="src/lib/"]:not([data-file-tree-sticky-row="true"])'
    );
    const renameInput = renameRow.locator('input[data-item-rename-input]');
    await expect(menu).toHaveCount(0);
    await expect(renameRow).toBeVisible();
    expect(
      await renameRow.getAttribute('data-file-tree-sticky-row')
    ).toBeNull();
    await expect(renameInput).toBeFocused();
    await expect(renameInput).toHaveValue('lib');
    await expect(
      mainTree.locator(
        'button[data-file-tree-sticky-row="true"] input[data-item-rename-input]'
      )
    ).toHaveCount(0);
  });

  test('portaled context-menu rename keeps the inline input focused', async ({
    page,
  }) => {
    await page.goto(
      '/test/e2e/fixtures/file-tree-portaled-context-menu-rename.html'
    );
    await page.waitForFunction(
      () => window.__fileTreeRenameFixtureReady === true
    );

    const tree = page.locator('file-tree-container').nth(0);
    const indexRow = tree.locator(
      'button[data-type="item"][data-item-path="src/index.ts"]'
    );
    await indexRow.click();
    await indexRow.click({ button: 'right' });

    const menu = page.locator('[data-test-context-menu-mode="portaled"]');
    await expect(menu).toBeVisible();
    await page.locator('[data-test-menu-rename="src/index.ts"]').click();

    const renameInput = tree.locator('input[data-item-rename-input]');
    await expect(renameInput).toBeFocused();
    await expect(renameInput).toHaveValue('index.ts');
  });
  test('trigger-opened menu still restores focus after a prior rename flow disabled restoreFocus', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-rename.html');
    await page.waitForFunction(
      () => window.__fileTreeRenameFixtureReady === true
    );

    const mainTree = page.locator('file-tree-container').nth(0);
    const indexRow = mainTree.locator(
      'button[data-type="item"][data-item-path="src/index.ts"]'
    );
    await indexRow.click();

    await indexRow.click({ button: 'right' });
    await page.locator('[data-test-menu-rename="src/index.ts"]').click();
    const renameInput = mainTree.locator('input[data-item-rename-input]');
    await expect(renameInput).toBeFocused();
    await renameInput.press('Escape');
    await expect(renameInput).toHaveCount(0);

    const focusedBeforeTrigger = await getFocusedPath(page);
    expect(focusedBeforeTrigger).toBe('src/index.ts');

    await indexRow.hover();
    const trigger = mainTree.locator(
      'button[data-type="context-menu-trigger"][data-visible="true"]'
    );
    await expect(trigger).toBeVisible();
    await trigger.click();

    const menu = page.locator('[data-test-context-menu="true"]');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await page.keyboard.press('ArrowDown');
    await expect
      .poll(() => getFocusedPath(page))
      .not.toBe(focusedBeforeTrigger);
  });

  test('search-open rename clears the filter and keeps the target visible on the unfiltered tree', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-rename.html');
    await page.waitForFunction(
      () => window.__fileTreeRenameFixtureReady === true
    );

    const mainTree = page.locator('file-tree-container').nth(0);
    const readmeRow = mainTree.locator(
      'button[data-type="item"][data-item-path="README.md"]'
    );
    await readmeRow.click();
    await readmeRow.press('w');

    const searchInput = mainTree.locator('input[data-file-tree-search-input]');
    await expect(searchInput).toBeFocused();
    await searchInput.fill('worker');

    const workerRow = mainTree.locator(
      'button[data-item-path="src/utils/worker.ts"]'
    );
    await expect(workerRow).toBeVisible();
    await expect(
      mainTree.locator('button[data-item-path="README.md"]')
    ).toHaveCount(0);

    await workerRow.click();
    await workerRow.press('F2');

    const renameInput = mainTree.locator('input[data-item-rename-input]');
    await expect(renameInput).toBeFocused();
    await expect(renameInput).toHaveValue('worker.ts');
    await expect(searchInput).toHaveValue('');
    await expect(
      mainTree.locator('button[data-item-path="README.md"]')
    ).toBeVisible();
  });

  test('flattened leaf rename keeps the input on the terminal segment and commits the folder move', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-rename.html');
    await page.waitForFunction(
      () => window.__fileTreeRenameFixtureReady === true
    );

    const flatTree = page.locator('file-tree-container').nth(1);
    const flatRow = flatTree.locator(
      'button[data-type="item"][data-item-type="folder"]'
    );
    await flatRow.click();
    await flatRow.press('F2');

    const renameInput = flatTree.locator(
      'input[data-item-flattened-rename-input]'
    );
    await expect(renameInput).toBeFocused();
    await expect(renameInput).toHaveValue('deep');

    const segments = flatTree.locator('[data-item-flattened-subitem]');
    await expect(segments).toHaveCount(3);
    await expect(
      segments.nth(0).locator('[data-item-rename-input]')
    ).toHaveCount(0);
    await expect(
      segments.nth(2).locator('[data-item-rename-input]')
    ).toHaveCount(1);

    await renameInput.fill('renamed');
    await renameInput.press('Enter');

    await expect(
      flatTree.locator('button[data-item-path="src/utils/renamed/"]')
    ).toBeVisible();
    await expect(page.locator('[data-file-tree-rename-log]')).toContainText(
      'flat:commit src/utils/deep -> src/utils/renamed'
    );
  });
});
