import { expect, test } from '@playwright/test';

test('find from an editable CodeView uses its panel and reaches offscreen matches', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/code-view-search.html');
  const root = page.locator('[data-code-view-root]');
  const content = root.locator('[contenteditable="true"]');
  await content.click();
  await page.keyboard.press('ControlOrMeta+f');

  const panel = root.locator('[data-search-panel-overlay]');
  const input = panel.getByRole('textbox', { name: 'Search' });
  await expect(input).toBeFocused();
  await expect(root.getByRole('textbox', { name: 'Search' })).toHaveCount(1);
  await input.fill('github');
  await expect(panel.locator('[data-matches]')).toHaveText('1 of 4');
  for (let match = 2; match <= 4; match++) {
    await input.press('Enter');
    await expect(panel.locator('[data-matches]')).toHaveText(`${match} of 4`);
  }

  const line201 = content.locator('[data-line="201"]');
  await expect(line201).toBeInViewport();
  await expect(input).toBeFocused();

  // Returning focus to an editor must keep find-again on the CodeView panel.
  await line201.click();
  await page.keyboard.press('ControlOrMeta+Shift+g');
  await expect(panel.locator('[data-matches]')).toHaveText('3 of 4');
  await expect(content.locator('[data-line="128"]')).toBeInViewport();
  await page.keyboard.press('ControlOrMeta+g');
  await expect(panel.locator('[data-matches]')).toHaveText('4 of 4');
  await expect(line201).toBeInViewport();

  // User scrolling must remain usable after visiting the offscreen match.
  await root.hover();
  await page.mouse.wheel(0, 2000);
  await expect(line201).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+f');
  await expect(input).toBeFocused();
  await input.press('Enter');
  await expect(panel.locator('[data-matches]')).toHaveText('1 of 4');
  await expect(content.locator('[data-line="125"]')).toBeInViewport();

  await content.locator('[data-line="125"]').click();
  await page.keyboard.press('Escape');
  await expect(root.locator('[data-search-panel]')).toHaveCount(0);
  await page.keyboard.type('typed');
  await expect(content).toContainText('typed');
});
