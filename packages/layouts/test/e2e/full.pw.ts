import { expect, test } from '@playwright/test';

// `allFeatures()` with every part (demo/full.tsx).

test('allFeatures() gives every command, and the parts render every sheet', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/full.html');
  await expect(page.locator('[data-layouts-pane]')).toHaveCount(4);
  const commands = await page.evaluate(() => {
    const layout = (
      window as unknown as { __full: { layout: Record<string, unknown> } }
    ).__full.layout;
    return [
      'split',
      'close',
      'move',
      'swap',
      'activate',
      'addTab',
      'moveToStack',
      'moveTab',
      'setHidden',
      'toStoredTree',
      'setStoredTree',
      'toggleZoom',
      'setZoom',
    ].filter((name) => typeof layout[name] !== 'function');
  });
  expect(commands).toEqual([]);
  const sheets = await page.evaluate(() =>
    [
      ...document.head.querySelectorAll<HTMLStyleElement>(
        'style[data-precedence="pierre-layouts"]'
      ),
    ]
      .map((style) => style.dataset.href)
      .sort((a = '', b = '') => a.localeCompare(b))
  );
  expect(sheets).toEqual(
    [
      'content',
      'corners',
      'drop',
      'flip',
      'focus-ring',
      'headers',
      'split',
      'tab-drag',
      'tabs',
      'zoom',
    ].map((name) => `pierre-layouts-${name}`)
  );
  await expect(page.locator('.pierre-layouts-focus')).toHaveCount(1);
  // The separator of the column meets the separator of the row.
  await expect(page.locator('.pierre-layouts-corner')).toHaveCount(1);
});
