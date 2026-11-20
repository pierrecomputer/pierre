import { expect, type Page, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/consumer.html');
  await expect(
    page.getByRole('tab', { name: 'editor', exact: true })
  ).toBeVisible();
});

const host = (page: Page, id: string) =>
  page.locator(`[data-layout-pane="${id}"]`);

test('custom headers retain keyboard tabs, lone tabs, close controls, and edge metadata', async ({
  page,
}) => {
  await expect(page.locator('[data-custom-header]')).toHaveCount(2);
  await expect(host(page, 'editor')).toHaveAttribute(
    'data-layout-edges',
    'top bottom left'
  );
  await expect(host(page, 'terminal')).toHaveAttribute(
    'data-layout-edges',
    'top right bottom'
  );
  await page.getByRole('tab', { name: 'editor', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('tab', { name: 'preview', exact: true })
  ).toBeFocused();
  await expect(
    host(page, 'editor').locator('[data-custom-header]')
  ).toHaveCount(0);
  await page
    .getByRole('tab', { name: 'preview', exact: true })
    .locator('[data-layout-tab-close]')
    .click();
  await expect(host(page, 'preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Single pane' }).click();
  await expect(
    page.getByRole('tab', { name: 'only', exact: true })
  ).toBeVisible();
  await expect(page.locator('[data-layout-tab-close]')).toHaveCount(0);
});

test('external zoom keeps focus outside and disables all layout animations', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'External zoom' }).click();
  await expect(page.locator('#outside')).toBeFocused();
  await expect(host(page, 'terminal')).toHaveAttribute(
    'data-layout-edges',
    'top right bottom left'
  );
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('a tab drops into another group and can split back out at an edge', async ({
  page,
}) => {
  const tab = await page
    .getByRole('tab', { name: 'preview', exact: true })
    .boundingBox();
  const terminal = await host(page, 'terminal').boundingBox();
  if (tab === null || terminal === null) throw new Error('Missing drag boxes');
  await page.mouse.move(tab.x + 10, tab.y + tab.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    terminal.x + terminal.width / 2,
    terminal.y + terminal.height / 2,
    { steps: 12 }
  );
  await page.mouse.up();
  await expect(host(page, 'preview').getByRole('tab')).toHaveCount(2);
  const moved = await page
    .getByRole('tab', { name: 'preview', exact: true })
    .boundingBox();
  const editor = await host(page, 'editor').boundingBox();
  if (moved === null || editor === null) throw new Error('Missing split boxes');
  await page.mouse.move(moved.x + 10, moved.y + moved.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    editor.x + editor.width / 2,
    editor.y + editor.height - 10,
    { steps: 12 }
  );
  await page.mouse.up();
  await expect(page.locator('[data-custom-header]')).toHaveCount(3);
  await expect(host(page, 'preview').getByRole('tab')).toHaveCount(1);
});

test('resize reports once at pointer release, after keyboard changes, and never on cancellation', async ({
  page,
}) => {
  const separator = page.getByRole('separator').first();
  const box = await separator.boundingBox();
  if (box === null) throw new Error('Missing separator');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 5 });
  await expect(page.locator('#resizes')).toHaveText('[]');
  await page.mouse.up();
  await expect(page.locator('#resizes')).toContainText('row');
  expect(JSON.parse(await page.locator('#resizes').innerText())).toHaveLength(
    1
  );
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  expect(JSON.parse(await page.locator('#resizes').innerText())).toHaveLength(
    2
  );
  const next = await separator.boundingBox();
  if (next === null) throw new Error('Missing resized separator');
  await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2);
  await page.mouse.down();
  await page.mouse.move(next.x + 80, next.y + next.height / 2);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(JSON.parse(await page.locator('#resizes').innerText())).toHaveLength(
    2
  );
  await expect(page.locator('#sessions')).toHaveText(
    JSON.stringify(['pointer applied', 'keyboard applied', 'pointer cancelled'])
  );
});

const readJson = async (page: Page, selector: string): Promise<unknown> =>
  JSON.parse(await page.locator(selector).innerText());

const rowSizes = async (page: Page): Promise<unknown> =>
  ((await readJson(page, '#tree')) as { sizes: unknown }).sizes;

// Press the row separator and move the pointer 80 px to the right.
async function startRowDrag(page: Page): Promise<void> {
  const separator = page.getByRole('separator', {
    name: 'Resize the row split',
  });
  const box = await separator.boundingBox();
  if (box === null) throw new Error('Missing separator');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 5 });
}

test('a resize session constrains pointer and keyboard resizes and ends each once', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Snap to eighths' }).click();
  await startRowDrag(page);
  await page.mouse.up();
  expect(await rowSizes(page)).toEqual([0.625, 0.375]);
  await page.getByRole('separator', { name: 'Resize the row split' }).focus();
  await page.keyboard.press('End');
  expect(await rowSizes(page)).toEqual([0.875, 0.125]);
  await expect(page.locator('#sessions')).toHaveText(
    JSON.stringify(['pointer applied', 'keyboard applied'])
  );
  expect(await readJson(page, '#resizes')).toEqual([
    { row: [0.625, 0.375] },
    { row: [0.875, 0.125] },
  ]);
});

test('a window blur applies an active resize and ends its session', async ({
  page,
}) => {
  await startRowDrag(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('.pierre-layout')).toHaveAttribute(
    'data-resizing',
    'false'
  );
  await expect(page.locator('#sessions')).toHaveText(
    JSON.stringify(['pointer applied'])
  );
  const applied = await rowSizes(page);
  expect(applied).not.toEqual([1, 1]);
  await page.mouse.move(700, 300);
  await page.mouse.up();
  expect(await rowSizes(page)).toEqual(applied);
  expect(await readJson(page, '#resizes')).toHaveLength(1);
});

test('an unmount during a resize restores the sizes and cancels the session', async ({
  page,
}) => {
  await startRowDrag(page);
  expect(await rowSizes(page)).not.toEqual([1, 1]);
  // A click from script: the pointer stays down on the separator.
  await page.evaluate(() => document.getElementById('mount')?.click());
  await expect(page.locator('.pierre-layout')).toHaveCount(0);
  await expect(page.locator('#sessions')).toHaveText(
    JSON.stringify(['pointer cancelled'])
  );
  expect(await rowSizes(page)).toEqual([1, 1]);
  await page.mouse.up();
  await expect(page.locator('#resizes')).toHaveText('[]');
});

test('separator and pane host props add app classes, children, labels, and attributes', async ({
  page,
}) => {
  const separator = page.getByRole('separator', {
    name: 'Resize the row split',
  });
  await expect(separator).toHaveClass(
    /^pierre-layout-separator consumer-separator$/
  );
  await expect(separator.locator('[data-separator-grip]')).toHaveCount(1);
  await expect(host(page, 'editor')).toHaveClass(
    /^pierre-layout-pane consumer-pane$/
  );
  await expect(host(page, 'editor')).toHaveAttribute(
    'data-drop-target',
    'editor'
  );
  await expect(host(page, 'editor')).toHaveAttribute('tabindex', '0');
  // A structural host: no drop target and no tab stop.
  await expect(host(page, 'terminal')).not.toHaveAttribute('data-drop-target');
  await expect(host(page, 'terminal')).toHaveAttribute('tabindex', '-1');
  // A hidden tab is never a tab stop.
  await expect(host(page, 'preview')).toHaveAttribute(
    'data-drop-target',
    'preview'
  );
  await expect(host(page, 'preview')).toHaveAttribute('tabindex', '-1');
  // A resize key stays in the layout; another key reaches the app.
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#app-keys')).toHaveText('0');
  expect(await rowSizes(page)).not.toEqual([1, 1]);
  await page.keyboard.press('a');
  await expect(page.locator('#app-keys')).toHaveText('1');
  await separator.dblclick();
  expect(await rowSizes(page)).toEqual([1, 1]);
});

test('a key that pane content handles does not reach the layout', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Zoom terminal' }).click();
  await expect(host(page, 'terminal')).toHaveAttribute('data-zoomed', 'true');
  const input = page.getByRole('textbox', { name: 'Content terminal' });
  await input.fill('ls');
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(host(page, 'terminal')).toHaveAttribute('data-zoomed', 'true');
  await input.press('Escape');
  await expect(host(page, 'terminal')).toHaveAttribute('data-zoomed', 'false');
});
