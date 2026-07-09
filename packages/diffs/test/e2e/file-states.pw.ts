import { expect, type Page, test } from '@playwright/test';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/file-states.html');
  await page.waitForFunction(() => window.__fileStatesReady === true);
}

test.describe('file states', () => {
  test('an added file renders only additions', async ({ page }) => {
    await openFixture(page);

    const added = page.locator('[data-added-mount]');
    // Only the additions column exists for a newly added file.
    await expect(added.locator('[data-code][data-additions]')).toHaveCount(1);
    await expect(added.locator('[data-code][data-deletions]')).toHaveCount(0);
    await expect(
      added.locator('[data-line-type="change-deletion"]')
    ).toHaveCount(0);
    await expect(
      added.locator('[data-line-type="change-addition"]').first()
    ).toBeVisible();
    await expect(added.locator('[data-content]')).toContainText(
      'export const created = true;'
    );
  });

  test('a deleted file renders only deletions', async ({ page }) => {
    await openFixture(page);

    const deleted = page.locator('[data-deleted-mount]');
    // Only the deletions column exists for a removed file.
    await expect(deleted.locator('[data-code][data-deletions]')).toHaveCount(1);
    await expect(deleted.locator('[data-code][data-additions]')).toHaveCount(0);
    await expect(
      deleted.locator('[data-line-type="change-addition"]')
    ).toHaveCount(0);
    await expect(
      deleted.locator('[data-line-type="change-deletion"]').first()
    ).toBeVisible();
    await expect(deleted.locator('[data-content]')).toContainText(
      'export const removed = true;'
    );
  });
});
