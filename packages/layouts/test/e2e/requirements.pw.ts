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

test('A21: a pane region takes its name from the heading of its title', async ({
  page,
}) => {
  const region = page.getByRole('region', { name: 'Pane 1', exact: true });
  const heading = region.getByRole('heading', { name: 'Pane 1', exact: true });
  await expect(heading).toBeVisible();
  const headingId =
    (await heading.getAttribute('id')) ?? 'a heading with an id';
  await expect(region).toHaveAttribute('aria-labelledby', headingId);
  // In a stack, the host is a tab panel that its tab names. When the stack
  // has one tab again, the demo shows the title, and the heading names the
  // region again.
  const host = page.locator('[data-layouts-pane="1"]');
  await heading.click();
  await page.getByRole('button', { name: 'Add tab', exact: true }).click();
  await expect(host).toHaveAttribute('role', 'tabpanel');
  await expect(host).not.toHaveAttribute('aria-labelledby', headingId);
  const ids = await page
    .locator('[data-layouts-pane]')
    .evaluateAll((panes) =>
      panes.map((pane) => (pane as HTMLElement).dataset.layoutsPane)
    );
  const added = ids.find(
    (id) => !['1', '2', '3', '4', '5', '6', '7'].includes(id ?? '')
  );
  await page
    .getByRole('button', { name: `Close Pane ${added}`, exact: true })
    .click();
  await expect(host).not.toHaveAttribute('role');
  await expect(region).toHaveAttribute('aria-labelledby', headingId);
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
  await page.emulateMedia({ forcedColors: 'active' });
  const separator = page.getByRole('separator').first();
  await separator.focus();
  const outline = await separator.evaluate(
    (element) => getComputedStyle(element).outlineStyle
  );
  expect(outline).not.toBe('none');
});

test('A16: a corner is a pointer shortcut of 24 CSS pixels with a resting contrast of 3:1', async ({
  page,
}) => {
  const corner = page.locator('.pierre-layouts-corner').first();
  // The two separators give the keyboard path, so the corner is not a control
  // for the keyboard or for assistive technology.
  await expect(corner).toHaveAttribute('aria-hidden', 'true');
  await corner.evaluate((element: HTMLElement) => element.focus());
  await expect(corner).not.toBeFocused();
  const result = await corner.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const hits = [
      [-11.5, 0],
      [11.5, 0],
      [0, -11.5],
      [0, 11.5],
    ].map(([dx, dy]) => document.elementFromPoint(x + dx, y + dy) === element);
    // The color behind the corner is the first opaque background of an
    // ancestor of the layout.
    let behind = 'rgb(255, 255, 255)';
    for (
      let node = element.parentElement;
      node !== null;
      node = node.parentElement
    ) {
      const color = getComputedStyle(node).backgroundColor;
      if (color !== 'rgba(0, 0, 0, 0)') {
        behind = color;
        break;
      }
    }
    const luminance = (color: string): number => {
      const [r, g, b] = (color.match(/[\d.]+/g) ?? []).map((value) => {
        const channel = Number(value) / 255;
        return channel <= 0.039_28
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [light, dark] = [
      luminance(behind),
      luminance(getComputedStyle(element).backgroundColor),
    ].sort((a, b) => b - a);
    return { hits, contrast: (light + 0.05) / (dark + 0.05) };
  });
  expect(result.hits).toEqual([true, true, true, true]);
  expect(result.contrast).toBeGreaterThanOrEqual(3);
});

test('A19: each control in a pane header is at least 24 by 24 CSS pixels', async ({
  page,
}) => {
  // Add a tab, so that the headers also hold a tab list.
  await page.locator('[data-layouts-pane="1"] .pierre-layouts-title').click();
  await page.getByRole('button', { name: 'Add tab', exact: true }).click();
  // A press up to 12 px from the middle of a control, on each axis, reaches
  // the control: no separator or corner target covers it.
  const misses = await page
    .locator('.pierre-layouts-header')
    .locator('button, [role="tab"]')
    .evaluateAll((controls) =>
      controls
        .filter((control) => control.checkVisibility())
        .map((control) => {
          const box = control.getBoundingClientRect();
          const x = box.left + box.width / 2;
          const y = box.top + box.height / 2;
          const reached = [
            [-11.5, 0],
            [11.5, 0],
            [0, -11.5],
            [0, 11.5],
          ].filter(([dx, dy]) =>
            control.contains(document.elementFromPoint(x + dx, y + dy))
          ).length;
          return {
            name: control.getAttribute('aria-label') ?? control.textContent,
            size: Math.min(box.width, box.height),
            reached,
          };
        })
    );
  expect(misses.length).toBeGreaterThan(20);
  expect(
    misses.filter(({ size, reached }) => size < 24 || reached < 4)
  ).toEqual([]);
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

test('A18: the status message announces a zoom, a restore, a split, a close, and a move with the titles of the panes', async ({
  page,
}) => {
  // The live region of the layout; the page has a status region of its own.
  const status = page.locator('.pierre-layouts > [role="status"]');
  await page.getByRole('button', { name: 'Zoom Pane 1', exact: true }).click();
  await expect(status).toHaveText('Pane 1 zoomed');
  await page.getByRole('button', { name: 'Zoom Pane 1', exact: true }).click();
  await expect(status).toHaveText('Pane 1 restored');
  // Pane 1 has the focus, so the new pane opens to its right.
  await page.getByRole('button', { name: 'Split right', exact: true }).click();
  await expect(status).toHaveText(/^Pane \d+ opened to the right of Pane 1$/);
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
  await page.getByRole('button', { name: 'Zoom Pane 2', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom Pane 2', exact: true }).click();
  await expect(status).toHaveText('Pane 2 zoomed');
  expect(await before?.evaluate((span) => span.isConnected)).toBe(false);
});
