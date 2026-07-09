import { expect, type Page, test } from '@playwright/test';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/annotations.html');
  await page.waitForFunction(() => window.__annotationsReady === true);
}

test.describe('line annotations', () => {
  test('renders custom annotation content anchored to its line', async ({
    page,
  }) => {
    await openFixture(page);

    // The shadow DOM carries the annotation row + slot for line index 1.
    await expect(page.locator('[data-line-annotation]')).toHaveCount(1);

    // The custom content is projected through the light-DOM slot named for the
    // annotation's line, and is visible to the user.
    const slotted = page.locator('[data-annotation-slot][slot="annotation-2"]');
    await expect(slotted).toHaveCount(1);
    const content = slotted.locator('[data-test-annotation]');
    await expect(content).toBeVisible();
    await expect(content).toHaveText('note on line 2');
  });
});
