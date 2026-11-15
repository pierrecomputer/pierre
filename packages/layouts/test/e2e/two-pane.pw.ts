import { expect, type Page, test } from '@playwright/test';

// App A of the modular entry points (demo/two-pane.tsx): `Layout.Root` with
// no features and no pane chrome.

interface TwoPanePage {
  layout: {
    getSnapshot(): { root: { sizes?: readonly unknown[] } };
  };
  resizes: Record<string, unknown>[];
  renders: Record<string, number>;
}

const sidebarWidth = (page: Page): Promise<number> =>
  page
    .locator('[data-layout-pane="sidebar"]')
    .evaluate((host) => host.getBoundingClientRect().width);

// The `pierre-layouts` sheets in `document.head`, by name.
const sheets = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [
      ...document.head.querySelectorAll<HTMLStyleElement>(
        'style[data-precedence="pierre-layouts"]'
      ),
    ].map((style) => style.dataset.href ?? '')
  );

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('the two-pane app renders its hosts, a separator, and the split sheet only', async ({
  page,
}) => {
  await page.goto('/two-pane.html');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(2);
  await expect(page.getByRole('separator')).toHaveCount(1);
  expect(await sheets(page)).toEqual(['pierre-layouts-split']);
  // React puts the sheet in the head, not in the layout.
  await expect(page.locator('.pierre-layout style')).toHaveCount(0);
  const text = await page
    .locator('head style[data-href="pierre-layouts-split"]')
    .textContent();
  expect(text?.trimStart().startsWith('@layer pierre-layouts')).toBe(true);
  await expect(page.getByRole('status')).toHaveText('2 panes');
});

test('an app rule without a layer wins over the split sheet', async ({
  page,
}) => {
  await page.goto('/two-pane.html');
  const host = page.locator('[data-layout-pane="main"]');
  await expect(host).toHaveCSS('border-top-left-radius', '10px');
  await page.addStyleTag({
    content: '.pierre-layout-pane { border-radius: 3px; }',
  });
  await expect(host).toHaveCSS('border-top-left-radius', '3px');
});

test('a key on the separator resizes the sidebar and reports the sizes', async ({
  page,
}) => {
  await page.goto('/two-pane.html');
  const before = await sidebarWidth(page);
  const separator = page.getByRole('separator');
  await expect(separator).toHaveCSS('cursor', 'col-resize');
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  expect(await sidebarWidth(page)).toBeGreaterThan(before);
  const resizes = await page.evaluate(
    () => (window as unknown as { __twoPane: TwoPanePage }).__twoPane.resizes
  );
  expect(resizes).toHaveLength(1);
  expect(Object.keys(resizes[0])).toEqual(['root']);
});

test('a pointer drag resizes, and Escape restores the sizes with no report', async ({
  page,
}) => {
  await page.goto('/two-pane.html');
  const before = await sidebarWidth(page);
  const box = await page.getByRole('separator').boundingBox();
  if (box === null) throw new Error('Missing separator');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, {
    steps: 4,
  });
  await expect(page.locator('.pierre-layout')).toHaveAttribute(
    'data-resizing',
    'true'
  );
  expect(await sidebarWidth(page)).toBeGreaterThan(before + 60);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await sidebarWidth(page)).toBe(before);
  await expect(page.locator('.pierre-layout')).toHaveAttribute(
    'data-resizing',
    'false'
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { __twoPane: TwoPanePage }).__twoPane.resizes
    )
  ).toEqual([]);
});

test('a collapse to 0 pixels hides and inerts the whole pane, with no render of its content', async ({
  page,
}) => {
  await page.goto('/two-pane.html');
  const rendersBefore = await page.evaluate(
    () => (window as unknown as { __twoPane: TwoPanePage }).__twoPane.renders
  );
  await page.getByRole('button', { name: 'Collapse the sidebar' }).click();
  const host = page.locator('[data-layout-pane="sidebar"]');
  await expect(host).toHaveAttribute('data-collapsed', 'true');
  await expect(host).toHaveAttribute('aria-hidden', 'true');
  await expect(host).toHaveAttribute('tabindex', '-1');
  await expect(host).toHaveCSS('content-visibility', 'hidden');
  expect(await host.evaluate((element: HTMLElement) => element.inert)).toBe(
    true
  );
  // The host keeps its two borders of 1 pixel.
  expect(await sidebarWidth(page)).toBeLessThanOrEqual(2);
  expect(
    await page.evaluate(
      () => (window as unknown as { __twoPane: TwoPanePage }).__twoPane.renders
    )
  ).toEqual(rendersBefore);
  await page.getByRole('button', { name: 'Expand the sidebar' }).click();
  await expect(host).toHaveAttribute('data-collapsed', 'false');
  expect(await host.evaluate((element: HTMLElement) => element.inert)).toBe(
    false
  );
});

test('the controlled form reports a resize and follows the tree of the app', async ({
  page,
}) => {
  await page.goto('/two-pane.html?form=controlled');
  const before = await sidebarWidth(page);
  await page.getByRole('separator').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await sidebarWidth(page)).toBeGreaterThan(before);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __twoPane: TwoPanePage }).__twoPane.resizes
          .length
    )
  ).toBe(2);
});

test('stylesheets with a nonce give each sheet the nonce', async ({ page }) => {
  await page.goto('/two-pane.html?stylesheets=nonce');
  expect(await sheets(page)).toEqual(['pierre-layouts-split']);
  expect(
    await page
      .locator('head style[data-href="pierre-layouts-split"]')
      .evaluate((style: HTMLStyleElement) => style.nonce)
  ).toBe('two-pane-nonce');
});

test('stylesheets null renders no sheet, and the linked stylesheet styles the layout', async ({
  page,
}) => {
  await page.goto('/two-pane.html?stylesheets=none');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(2);
  await expect(page.locator('[data-layout-pane="main"]')).toHaveCSS(
    'border-top-left-radius',
    '10px'
  );
  expect(await sheets(page)).toEqual([]);
});
