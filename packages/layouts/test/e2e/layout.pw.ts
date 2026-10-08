import { expect, test } from '@playwright/test';

import { computeLayout, LayoutStore } from '../../src';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(7);
});

test('container resizing resolves synchronously in CSS while zoom still animates', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await page.evaluate(() =>
    localStorage.getItem('pierre-layouts-demo')
  );
  if (saved === null) throw new Error('Missing saved layout');
  const store = new LayoutStore({ type: 'pane', id: 'initial' });
  store.restore(saved);
  const workspace = page.getByRole('group', { name: 'Layout playground' });
  const updates = await workspace.evaluate((element) => {
    const container = element as HTMLElement;
    const panes = [
      ...container.querySelectorAll<HTMLElement>('[data-layout-pane]'),
    ];
    const styles = panes.map((pane) => pane.getAttribute('style'));
    // Read in the same JS task: neither ResizeObserver nor React can run between size changes.
    const samples = [];
    for (const [width, height] of [
      [800, 600],
      [1000, 450],
      [300, 180],
      [950, 700],
    ]) {
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
      const bounds = container.getBoundingClientRect();
      samples.push({
        width: bounds.width,
        height: bounds.height,
        panes: panes.map((pane) => {
          const box = pane.getBoundingClientRect();
          return {
            id: pane.dataset.layoutPane,
            x: box.x - bounds.x,
            y: box.y - bounds.y,
            width: box.width,
            height: box.height,
            durations: getComputedStyle(pane)
              .transitionDuration.split(',')
              .map((value) => value.trim()),
          };
        }),
        unchangedStyles: panes.every(
          (pane, index) => pane.getAttribute('style') === styles[index]
        ),
      });
    }
    container.style.width = '';
    container.style.height = '';
    return samples;
  });
  for (const sample of updates) {
    const expected = computeLayout(
      store.getSnapshot().root,
      sample.width,
      sample.height
    );
    expect(sample.unchangedStyles).toBe(true);
    for (const actual of sample.panes) {
      const pane = expected.panes.find(({ pane }) => pane.id === actual.id);
      if (pane === undefined) throw new Error('Missing expected pane');
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(actual[key] - pane.rect[key])).toBeLessThan(1);
      }
      expect(actual.durations.every((duration) => duration === '0s')).toBe(
        true
      );
    }
  }
  const pane = page.locator('[data-layout-pane="1"]');
  await page.getByRole('button', { name: 'Zoom Pane 1', exact: true }).click();
  expect(
    await pane.evaluate(
      (element) => getComputedStyle(element).transitionDuration
    )
  ).toContain('0.24s');
});

test('zoom and rearrangement retain pane DOM, notes, counters, and scroll', async ({
  page,
}) => {
  const pane = page.locator('[data-layout-pane="1"]');
  const original = await pane.elementHandle();
  const content = pane.locator('.pierre-layout-content');
  await page
    .getByLabel('Note in Pane 1', { exact: true })
    .fill('Keep this note');
  await page
    .getByRole('button', { name: 'Count in Pane 1', exact: true })
    .click();
  await page.getByRole('button', { name: 'Zoom Pane 1', exact: true }).click();
  await expect(page.locator('[data-layout-pane="2"]')).toHaveAttribute(
    'inert',
    ''
  );
  await expect(page.locator('[data-layout-pane="2"]')).toHaveAttribute(
    'aria-hidden',
    'true'
  );
  await expect(page.getByRole('separator')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('separator')).toHaveCount(6);
  await content.evaluate((element) => {
    const child = element.firstElementChild as HTMLElement;
    child.style.minHeight = '1500px';
    element.scrollTop = 120;
  });
  await page.getByLabel('Move target').selectOption('3');
  await page.getByLabel('Move direction').selectOption('bottom');
  // The move controls are outside the workspace, so interacting with them keeps pane 1 selected.
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByLabel('Note in Pane 1', { exact: true })).toHaveValue(
    'Keep this note'
  );
  await expect(
    page.getByRole('button', { name: 'Count in Pane 1', exact: true })
  ).toHaveText('Count 1');
  expect(
    await pane.evaluate((element, previous) => element === previous, original)
  ).toBe(true);
  expect(await content.evaluate((element) => element.scrollTop)).toBe(120);
});

test('pointer resizing, keyboard limits, and Escape cancellation', async ({
  page,
}) => {
  const handle = page.getByRole('separator', {
    name: 'Resize Pane 1, Pane 7 and Pane 2, Pane 5, Pane 6, Pane 4, Pane 3',
    exact: true,
  });
  const pane = page.locator('[data-layout-pane="1"]');
  const start = await pane.boundingBox();
  const bounds = await handle.boundingBox();
  if (start === null || bounds === null)
    throw new Error('Missing layout bounds');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 90, bounds.y + 20, { steps: 5 });
  expect((await pane.boundingBox())!.width).toBeGreaterThan(start.width + 60);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await pane.boundingBox())!.width).toBeCloseTo(start.width, 0);
  await handle.focus();
  await page.keyboard.press('Home');
  expect((await pane.boundingBox())!.width).toBeCloseTo(110, 0);
  await page.keyboard.press('ArrowRight');
  expect((await pane.boundingBox())!.width).toBeGreaterThan(110);
});

test('corner dragging adjusts both axes and preserves non-negative geometry', async ({
  page,
}) => {
  const corners = page.getByRole('button', {
    name: 'Resize both axes',
    exact: true,
  });
  const corner = corners.first();
  const bounds = await corner.boundingBox();
  if (bounds === null) throw new Error('Missing corner');
  const values = await page
    .getByRole('separator')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('aria-valuenow'))
    );
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(bounds.x + 55, bounds.y + 40, { steps: 6 });
  await page.mouse.up();
  const changed = await page
    .getByRole('separator')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('aria-valuenow'))
    );
  expect(
    changed.filter((value, index) => value !== values[index]).length
  ).toBeGreaterThanOrEqual(2);
  await page.setViewportSize({ width: 320, height: 600 });
  const valid = await page
    .locator('[data-layout-pane]')
    .evaluateAll((elements) =>
      elements.every((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width >= 0 &&
          rect.height >= 0 &&
          Number.isFinite(rect.x) &&
          Number.isFinite(rect.y)
        );
      })
    );
  expect(valid).toBe(true);
});

test('pointer rearrangement retains pane content and repairs focus after close', async ({
  page,
}) => {
  await page.getByLabel('Note in Pane 1', { exact: true }).fill('Drag me');
  const source = await page
    .getByRole('button', { name: 'Drag Pane 1', exact: true })
    .boundingBox();
  const target = await page.locator('[data-layout-pane="3"]').boundingBox();
  if (source === null || target === null) throw new Error('Missing panes');
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width - 20,
    target.y + target.height / 2,
    { steps: 10 }
  );
  await expect(page.locator('.pierre-layout-drop')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.pierre-layout-drop')).toHaveCount(0);
  await expect(page.getByLabel('Note in Pane 1', { exact: true })).toHaveValue(
    'Drag me'
  );
  await page.getByRole('button', { name: 'Close Pane 1', exact: true }).click();
  await expect(page.locator('[data-layout-pane]')).toHaveCount(6);
  await expect(
    page.locator('[data-layout-pane][data-focused="true"]')
  ).toBeFocused();
});

test('saving and reloading restores the split tree after edits', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Split right', exact: true }).click();
  await expect(page.locator('[data-layout-pane]')).toHaveCount(8);
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.locator('[data-layout-pane]')).toHaveCount(7);
});
