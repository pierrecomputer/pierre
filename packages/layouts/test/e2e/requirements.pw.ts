import { expect, test } from '@playwright/test';

// Requirements from test/test-plan.md that the prototype does not meet yet.
// `test.fail()` marks a known gap: the suite passes while the gap exists, and
// reports the test when a change fixes it, so that the marker is removed.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(7);
});

test('A3: each pane is a named region', async ({ page }) => {
  for (const name of ['Pane 1', 'Pane 3', 'Pane 7']) {
    await expect(page.getByRole('region', { name, exact: true })).toHaveCount(
      1
    );
  }
});

test('A5: the DOM order of panes follows their visual order', async ({
  page,
}) => {
  test.fail(true, 'Pane hosts are sorted by ID to keep their DOM stable.');
  const order = await page
    .locator('[data-layout-pane]')
    .evaluateAll((panes) =>
      panes.map((pane) => (pane as HTMLElement).dataset.layoutPane)
    );
  // Depth-first order of the mosaic split tree, which is its reading order.
  expect(order).toEqual(['1', '7', '2', '5', '6', '4', '3']);
});

test('A6: a separator is a pointer target of at least 24 CSS pixels', async ({
  page,
}) => {
  test.fail(true, 'The separator is as wide as the 8 px gap.');
  const box = await page.getByRole('separator').first().boundingBox();
  if (box === null) throw new Error('Missing separator');
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24);
});

test('A8: the zoom button keeps its name when it is pressed', async ({
  page,
}) => {
  test.fail(true, 'The name changes from "Zoom" to "Restore".');
  const pane = page.locator('[data-layout-pane="1"]');
  const button = pane.locator('header button[aria-pressed]');
  const before = await button.getAttribute('aria-label');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(await button.getAttribute('aria-label')).toBe(before);
});

test('A10: a focused separator shows an outline in forced colors mode', async ({
  page,
}) => {
  test.fail(true, 'The focus style uses only a background color.');
  await page.emulateMedia({ forcedColors: 'active' });
  const separator = page.getByRole('separator').first();
  await separator.focus();
  const outline = await separator.evaluate(
    (element) => getComputedStyle(element).outlineStyle
  );
  expect(outline).not.toBe('none');
});

test('A15: Escape that pane content handles does not restore the zoom', async ({
  page,
}) => {
  test.fail(true, 'The layout restores the zoom on any Escape.');
  await page.getByRole('button', { name: 'Zoom Pane 1', exact: true }).click();
  const note = page.getByLabel('Note in Pane 1', { exact: true });
  // Content such as a terminal or an editor handles Escape itself.
  await note.evaluate((input) =>
    input.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') event.preventDefault();
    })
  );
  await note.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-layout-pane="1"]')).toHaveAttribute(
    'data-zoomed',
    'true'
  );
});
