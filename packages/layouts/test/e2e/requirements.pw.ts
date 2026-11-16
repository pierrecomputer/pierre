import { expect, test } from '@playwright/test';

// Requirements from test/test-plan.md that the prototype does not meet yet.
// `test.fail()` marks a known gap: the suite passes while the gap exists, and
// reports the test when a change fixes it, so that the marker is removed.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('[data-layouts-pane]')).toHaveCount(7);
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
    .locator('[data-layouts-pane]')
    .evaluateAll((panes) =>
      panes.map((pane) => (pane as HTMLElement).dataset.layoutsPane)
    );
  // Depth-first order of the mosaic split tree, which is its reading order.
  expect(order).toEqual(['1', '7', '2', '5', '6', '4', '3']);
});

test('A6: a separator is a pointer target of at least 24 CSS pixels', async ({
  page,
}) => {
  // The visible gap stays 8 px; a press up to 12 px from the middle of the
  // separator, on either side, reaches it.
  const hits = await page
    .getByRole('separator')
    .first()
    .evaluate((element) => {
      const box = element.getBoundingClientRect();
      const vertical = element.getAttribute('aria-orientation') === 'vertical';
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      return [-11.5, 11.5].map(
        (offset) =>
          document.elementFromPoint(
            vertical ? x + offset : x,
            vertical ? y : y + offset
          ) === element
      );
    });
  expect(hits).toEqual([true, true]);
  const box = await page.getByRole('separator').first().boundingBox();
  expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBe(8);
});

test('A8: the zoom button keeps its name when it is pressed', async ({
  page,
}) => {
  test.fail(true, 'The name changes from "Zoom" to "Restore".');
  const pane = page.locator('[data-layouts-pane="1"]');
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
  await expect(page.locator('[data-layouts-pane="1"]')).toHaveAttribute(
    'data-zoomed',
    'true'
  );
});

test('A18: the status message announces a zoom, a close, and a move with the titles of the panes', async ({
  page,
}) => {
  // The live region of the layout; the page has a status region of its own.
  const status = page.locator('.pierre-layouts > [role="status"]');
  await page.getByRole('button', { name: 'Zoom Pane 1', exact: true }).click();
  await expect(status).toHaveText('Pane 1 zoomed');
  await page
    .getByRole('button', { name: 'Restore Pane 1', exact: true })
    .click();
  await expect(status).toHaveText('Pane 1 restored');
  await page.getByRole('button', { name: 'Close Pane 3', exact: true }).click();
  await expect(status).toHaveText('Pane 3 closed');
  // Drag pane 2 by its move handle to the right edge of pane 4.
  const handle = page
    .locator('[data-layouts-pane="2"]')
    .locator('.pierre-layouts-grip');
  const from = await handle.boundingBox();
  const to = await page.locator('[data-layouts-pane="4"]').boundingBox();
  if (from === null || to === null) throw new Error('Missing boxes');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 8, to.y + to.height / 2, {
    steps: 8,
  });
  await expect(status).toHaveText('Move Pane 2 to the right of Pane 4');
  await page.mouse.up();
  await expect(status).toHaveText('Pane 2 moved to the right of Pane 4');
  // The same text twice is a new element of the live region, so that a
  // screen reader speaks it again.
  const before = await status.locator('span').elementHandle();
  await page.getByRole('button', { name: 'Zoom Pane 2', exact: true }).click();
  await page
    .getByRole('button', { name: 'Restore Pane 2', exact: true })
    .click();
  await page.getByRole('button', { name: 'Zoom Pane 2', exact: true }).click();
  await expect(status).toHaveText('Pane 2 zoomed');
  expect(await before?.evaluate((span) => span.isConnected)).toBe(false);
});
