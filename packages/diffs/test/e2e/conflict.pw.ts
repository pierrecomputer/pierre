import { expect, type Page, test } from '@playwright/test';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/conflict.html');
  await page.waitForFunction(() => window.__conflictReady === true);
}

const actionButton = (conflictIndex: number, resolution: string): string =>
  `button[data-merge-conflict-action="${resolution}"][data-merge-conflict-conflict-index="${conflictIndex}"]`;

const CONTENT = '[data-content]';
const resolutions = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__conflictResolutions ?? []);

test.describe('merge conflict resolution', () => {
  test('renders conflict markers and per-conflict action buttons', async ({
    page,
  }) => {
    await openFixture(page);

    // Each conflict offers current / incoming / both, for two conflicts.
    await expect(page.locator('[data-merge-conflict-action]')).toHaveCount(6);
    await expect(page.locator(actionButton(0, 'current'))).toBeVisible();
    await expect(page.locator(actionButton(0, 'incoming'))).toBeVisible();
    await expect(page.locator(actionButton(1, 'both'))).toBeVisible();

    // Both sides of each conflict are present before resolution.
    await expect(page.locator(CONTENT)).toContainText('const ttl = 12;');
    await expect(page.locator(CONTENT)).toContainText('const ttl = 24;');
    // Conflict marker rows are rendered (start / separator / end per conflict).
    await expect(
      page.locator('[data-merge-conflict-marker-row]').first()
    ).toBeVisible();
  });

  test('accepting incoming resolves that conflict and keeps others interactive', async ({
    page,
  }) => {
    await openFixture(page);

    await page.locator(actionButton(0, 'incoming')).click();

    // The resolved conflict drops its action buttons and its "current" side.
    await expect(
      page.locator('[data-merge-conflict-conflict-index="0"]')
    ).toHaveCount(0);
    await expect(page.locator(CONTENT)).not.toContainText('const ttl = 12;');
    await expect(page.locator(CONTENT)).toContainText('const ttl = 24;');
    await expect.poll(() => resolutions(page)).toEqual(['incoming']);

    // The second, untouched conflict is still fully interactive.
    await expect(page.locator(actionButton(1, 'current'))).toBeVisible();
    await page.locator(actionButton(1, 'current')).click();

    await expect(
      page.locator('[data-merge-conflict-conflict-index="1"]')
    ).toHaveCount(0);
    await expect(page.locator(CONTENT)).toContainText('const max = 1;');
    await expect(page.locator(CONTENT)).not.toContainText('const max = 2;');
    await expect.poll(() => resolutions(page)).toEqual(['incoming', 'current']);
  });

  test('accepting both keeps current and incoming lines', async ({ page }) => {
    await openFixture(page);

    await page.locator(actionButton(0, 'both')).click();

    await expect(page.locator(CONTENT)).toContainText('const ttl = 12;');
    await expect(page.locator(CONTENT)).toContainText('const ttl = 24;');
    // Conflict markers for the resolved region are gone.
    await expect(
      page.locator('[data-merge-conflict-conflict-index="0"]')
    ).toHaveCount(0);
    await expect.poll(() => resolutions(page)).toEqual(['both']);
  });
});
