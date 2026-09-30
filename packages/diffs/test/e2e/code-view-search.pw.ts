import { expect, test } from '@playwright/test';

test('search scope follows focus across editors, the panel, and outside CodeView', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/code-view-search.html?scope');
  const root = page.locator('[data-code-view-root]');
  const editors = root.locator('[contenteditable="true"]');
  const first = editors.nth(0);
  const second = editors.nth(1);
  await first.click();
  await expect(root.locator('[data-search-panel]')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+f');
  const panel = root.locator('[data-search-panel-overlay]');
  const input = panel.getByRole('textbox', { name: 'Search' });
  const count = panel.locator('[data-matches]');
  await input.fill('target');
  await expect(count).toHaveText('1 of 1');
  await expect(
    root.locator('[data-deletions] [data-search-match]')
  ).toHaveCount(0);

  await second.click();
  await expect(count).toHaveText('2 results');
  await expect(second).toBeFocused();
  const matchCase = panel.getByRole('button', { name: 'Match Case' });
  await matchCase.click();
  await expect(matchCase).toHaveAttribute('aria-pressed', 'true');
  await expect(count).toContainText('of 2');
  await input.click();
  await page.keyboard.press('ControlOrMeta+f');
  await input.press('Enter');
  await expect(count).toContainText('of 2');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('target');

  await page.locator('[data-outside]').click();
  await expect(count).toContainText('of 5');
  await expect(
    root.locator('[data-deletions] [data-search-match]')
  ).toHaveCount(1);
  await expect(page.locator('[data-outside]')).toBeFocused();
  await expect(matchCase).toHaveAttribute('aria-pressed', 'true');
  await first.click();
  await expect(count).toHaveText('1 results');
  await expect(
    root.locator('[data-deletions] [data-search-match]')
  ).toHaveCount(0);
  await expect(first).toBeFocused();

  await root.focus();
  await page.keyboard.press('ControlOrMeta+f');
  await expect(count).toHaveText('5 results');
  await expect(input).toHaveValue('target');
  await expect(root.getByRole('textbox', { name: 'Search' })).toHaveCount(1);
  await input.press('Escape');
  await first.click();
  await expect(root.locator('[data-search-panel]')).toHaveCount(0);
});

test('refreshes search after typing and undo without a host update', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/code-view-search.html');
  const root = page.locator('[data-code-view-root]');
  const content = root.locator('[contenteditable="true"]');
  await content.click();
  await page.keyboard.press('ControlOrMeta+f');
  const panel = root.locator('[data-search-panel-overlay]');
  await panel.getByRole('textbox', { name: 'Search' }).fill('github');
  await expect(panel.locator('[data-matches]')).toHaveText('1 of 4');

  const line = content.locator('[data-line="125"]');
  await line.click();
  await page.keyboard.press('Home');
  await page.keyboard.type('github ');
  await expect(panel.locator('[data-matches]')).toContainText('5');
  await expect(line.locator('[data-search-match]')).toHaveCount(2);
  await expect(content).toBeFocused();

  await page.keyboard.press('ControlOrMeta+z');
  await expect(panel.locator('[data-matches]')).toContainText('4');
  await expect(line.locator('[data-search-match]')).toHaveCount(1);
});

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
