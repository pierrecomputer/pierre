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
});
