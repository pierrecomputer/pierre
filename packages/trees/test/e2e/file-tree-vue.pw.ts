import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __fileTreeVueFixtureReady?: boolean;
  }
}

test.describe('file-tree Vue fixture', () => {
  test('renders and updates through the Vue adapter', async ({ page }) => {
    await page.goto('/test/e2e/fixtures/file-tree-vue.html');
    await page.waitForFunction(() => window.__fileTreeVueFixtureReady === true);

    const tree = page.locator('file-tree-container');
    await expect(
      tree.locator('button[data-item-path="src/components/FileTree.vue"]')
    ).toBeVisible();

    await page.locator('[data-file-tree-vue-header-add]').click();
    await expect(
      tree.locator('button[data-item-path="src/generated-vue-file.ts"]')
    ).toBeVisible();
    await expect(page.locator('[data-file-tree-vue-state]')).toContainText(
      'selected=1'
    );

    await page.locator('[data-file-tree-vue-search]').click();
    await expect(page.locator('[data-file-tree-vue-state]')).toContainText(
      'search=vue'
    );
    await expect(
      tree.locator('button[data-item-path="src/components/FileTree.vue"]')
    ).toBeVisible();
  });
});
