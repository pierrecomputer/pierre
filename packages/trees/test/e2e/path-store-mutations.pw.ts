import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __pathStoreMutationsFixtureReady?: boolean;
  }
}

test.describe('path-store mutation proof', () => {
  test('adds and batches mutation changes in the rendered tree', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/path-store-mutations.html');
    await page.waitForFunction(
      () => window.__pathStoreMutationsFixtureReady === true
    );

    await page.locator('[data-path-store-mutation-action="add-file"]').click();
    await expect(
      page.locator(
        'file-tree-container button[data-item-path="src/demo-added.ts"]'
      )
    ).toBeVisible();
    await expect(page.locator('[data-path-store-mutations-log]')).toContainText(
      'mutation:add'
    );

    await page.locator('[data-path-store-mutation-action="batch"]').click();
    await expect(
      page.locator(
        'file-tree-container button[data-item-path="src/batch-folder/notes.md"]'
      )
    ).toBeVisible();
    await expect(page.locator('[data-path-store-mutations-log]')).toContainText(
      'mutation:batch'
    );
  });

  test('moves then resets the tree with the coarse reset path', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/path-store-mutations.html');
    await page.waitForFunction(
      () => window.__pathStoreMutationsFixtureReady === true
    );

    await page.locator('[data-path-store-mutation-action="move"]').click();
    await expect(
      page.locator('file-tree-container button[data-item-path="src/README.md"]')
    ).toBeVisible();
    await expect(
      page.locator('file-tree-container button[data-item-path="README.md"]')
    ).toHaveCount(0);

    await page.locator('[data-path-store-mutation-action="reset"]').click();
    await expect(
      page.locator('file-tree-container button[data-item-path="README.md"]')
    ).toBeVisible();
    await expect(
      page.locator('file-tree-container button[data-item-path="src/README.md"]')
    ).toHaveCount(0);
    await expect(page.locator('[data-path-store-mutations-log]')).toContainText(
      'mutation:reset'
    );
  });

  test('deletes a row through the reused context-menu shell', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/path-store-mutations.html');
    await page.waitForFunction(
      () => window.__pathStoreMutationsFixtureReady === true
    );

    const indexRow = page.locator(
      'file-tree-container button[data-item-path="src/index.ts"]'
    );
    await indexRow.click();
    await indexRow.click({ button: 'right' });

    await expect(page.locator('[data-test-context-menu="true"]')).toBeVisible();
    await page.locator('[data-test-menu-delete="src/index.ts"]').click();

    await expect(
      page.locator('file-tree-container button[data-item-path="src/index.ts"]')
    ).toHaveCount(0);
    await expect(page.locator('[data-test-context-menu="true"]')).toHaveCount(
      0
    );
    await expect(page.locator('[data-path-store-mutations-log]')).toContainText(
      'mutation:remove'
    );
  });
});
