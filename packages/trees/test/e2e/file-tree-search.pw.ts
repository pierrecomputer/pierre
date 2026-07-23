import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __fileTreeSearchFixtureReady?: boolean;
  }
}

test.describe('file-tree search proof', () => {
  test('printable-key open seeding and hide-non-matches filtering work in the visible search tree', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-search.html');
    await page.waitForFunction(
      () => window.__fileTreeSearchFixtureReady === true
    );

    const visibleTree = page.locator('file-tree-container').nth(0);
    const firstRow = visibleTree.locator(
      'button[data-type="item"][data-item-path="src/"]'
    );
    await expect(firstRow).toHaveCSS('text-align', 'start');
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
    await expect(page.locator('[data-file-tree-search-log]')).toContainText(
      'visible:worker'
    );
  });

  test('search keeps input focus while ArrowDown updates the focused match', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-search.html');
    await page.waitForFunction(
      () => window.__fileTreeSearchFixtureReady === true
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
    await page.goto('/test/e2e/fixtures/file-tree-search.html');
    await page.waitForFunction(
      () => window.__fileTreeSearchFixtureReady === true
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
    await expect(page.locator('[data-file-tree-search-log]')).toContainText(
      'visible:<closed>'
    );
  });

  test('hidden-input search still works programmatically', async ({ page }) => {
    await page.goto('/test/e2e/fixtures/file-tree-search.html');
    await page.waitForFunction(
      () => window.__fileTreeSearchFixtureReady === true
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
    await expect(page.locator('[data-file-tree-search-log]')).toContainText(
      'hidden:worker'
    );
  });

  test('Enter selects the focused match and keeps search open', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-search.html');
    await page.waitForFunction(
      () => window.__fileTreeSearchFixtureReady === true
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
    await searchInput.fill('worker');
    await page.keyboard.press('ArrowDown');

    const focusedBeforeSubmit = visibleTree.locator(
      'button[data-item-focused="true"]'
    );
    const focusedPathBeforeSubmit =
      await focusedBeforeSubmit.getAttribute('data-item-path');
    expect(focusedPathBeforeSubmit).not.toBeNull();

    await page.keyboard.press('Enter');

    const selectedRow = visibleTree.locator(
      'button[data-item-selected="true"]'
    );
    await expect(selectedRow).toHaveCount(1);
    await expect(selectedRow).toHaveAttribute(
      'data-item-path',
      focusedPathBeforeSubmit ?? ''
    );
    // Enter keeps the search open. The input keeps focus and its value.
    await expect(searchInput).toBeFocused();
    await expect(searchInput).toHaveValue('worker');
  });

  test('Enter immediately after ArrowDown still selects the latest focused match', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-search.html');
    await page.waitForFunction(
      () => window.__fileTreeSearchFixtureReady === true
    );

    const result = await page.evaluate(async () => {
      const host = document.querySelectorAll('file-tree-container')[0];
      const shadow = host?.shadowRoot;
      const firstRow = shadow?.querySelector<HTMLButtonElement>(
        'button[data-type="item"]'
      );
      const input = shadow?.querySelector<HTMLInputElement>(
        'input[data-file-tree-search-input]'
      );
      if (
        !(shadow instanceof ShadowRoot) ||
        !(firstRow instanceof HTMLButtonElement) ||
        !(input instanceof HTMLInputElement)
      ) {
        return null;
      }

      firstRow.focus();
      firstRow.click();
      input.focus();
      input.value = 'worker';
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          data: 'worker',
          inputType: 'insertText',
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'ArrowDown',
        })
      );
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Enter',
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 100));

      const selected = shadow.querySelector<HTMLButtonElement>(
        'button[data-item-selected="true"]'
      );
      const active = shadow.activeElement as HTMLElement | null;
      return {
        inputFocused: active === input,
        selectedPath: selected?.getAttribute('data-item-path') ?? null,
      };
    });

    expect(result).not.toBeNull();
    // Enter selects the match that ArrowDown moved to. This is true even when
    // the two keys arrive together with no render between them.
    expect(result?.selectedPath).toBe('src/utils/worker/index.ts');
    // Enter keeps the search open. Focus stays in the search input.
    expect(result?.inputFocused).toBe(true);
  });
});
