import { expect, test } from '@playwright/test';

test.describe('trees-dev drag-and-drop route', () => {
  test('host dropzone reads the file name without moving the tree row', async ({
    page,
  }) => {
    await page.goto('/trees-dev/drag-and-drop');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Drag and Drop' })
    ).toBeVisible();

    const sourcePath = 'assets/images/social/logo.png';
    const source = page.locator(
      `file-tree-container button[data-type="item"][data-item-path="${sourcePath}"]`
    );
    const dropzone = page.locator('[data-test-host-dropzone="true"]');

    await expect(source).toBeVisible();
    await expect(dropzone).toBeVisible();

    await source.dragTo(dropzone);

    await expect(
      page.locator('[data-test-host-dropzone-last-file="true"]')
    ).toContainText('logo.png');
    await expect(
      page.getByText(`external-drop:${sourcePath}`, { exact: true })
    ).toBeVisible();
    await expect(source).toHaveCount(1);
    await expect(source).toBeVisible();
  });

  test('internal drag still moves a row inside the tree', async ({ page }) => {
    await page.goto('/trees-dev/drag-and-drop');

    const sourcePath = 'assets/images/social/logo.png';
    const movedPath = 'docs/guides/logo.png';
    const source = page.locator(
      `file-tree-container button[data-type="item"][data-item-path="${sourcePath}"]`
    );
    const target = page.locator(
      'file-tree-container button[data-type="item"][data-item-path="docs/guides/"]'
    );
    const moved = page.locator(
      `file-tree-container button[data-type="item"][data-item-path="${movedPath}"]`
    );

    await expect(source).toBeVisible();
    await expect(target).toBeVisible();

    await source.dragTo(target);

    await expect(moved).toBeVisible();
    await expect(source).toHaveCount(0);
  });
});
