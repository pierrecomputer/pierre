import { expect, type Page, test } from '@playwright/test';

// `flip()` with `zoom()` (demo/zoom.tsx?flip=on): the animations, and the
// covered panes during and after the zoom animation.

const host = (page: Page, id: string) =>
  page.locator(`[data-layout-pane="${id}"]`);

const visibility = (page: Page): Promise<Record<string, boolean[]>> =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __zoom: { visibility: Record<string, boolean[]> };
        }
      ).__zoom.visibility
  );

// The running animations of the layout.
const flipAnimations = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      document
        .querySelector('.pierre-layout')
        ?.getAnimations({ subtree: true })
        .filter((animation) => animation.id === 'pierre-layout-flip').length ??
      0
  );

// The pane whose host holds the focus, or null.
const focusedPane = (page: Page): Promise<string | null> =>
  page.evaluate(
    () =>
      document.activeElement
        ?.closest<HTMLElement>('[data-layout-pane]')
        ?.getAttribute('data-layout-pane') ?? null
  );

const command = (page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([name, args]) => {
      const layout = (
        window as unknown as {
          __zoom: { layout: Record<string, (...args: unknown[]) => void> };
        }
      ).__zoom.layout;
      layout[name](...args);
    },
    [name, args] as const
  );

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test('during the zoom animation, the covered panes leave the accessibility tree and the tab order, and still render', async ({
  page,
}) => {
  await page.goto('/zoom.html?flip=on&duration=3000');
  await page.getByRole('button', { name: 'Zoom editor' }).click();
  expect(await flipAnimations(page)).toBeGreaterThan(0);
  const files = host(page, 'files');
  await expect(files).toHaveAttribute('aria-hidden', 'true');
  await expect(files).toHaveAttribute('tabindex', '-1');
  // It still renders: not inert, and no `content-visibility: hidden`.
  expect(await files.evaluate((element: HTMLElement) => element.inert)).toBe(
    false
  );
  await expect(files).not.toHaveAttribute('data-hidden');
  // Its controls are not in the accessibility tree.
  await expect(page.getByRole('button', { name: 'Zoom files' })).toHaveCount(0);
  // Tab does not reach a covered pane.
  for (let press = 0; press < 8; press++) {
    await page.keyboard.press('Tab');
    expect(['editor', null]).toContain(await focusedPane(page));
  }
  expect(await flipAnimations(page)).toBeGreaterThan(0);
  expect(await visibility(page)).toEqual({});
});

test('at the end of the zoom animation, the covered panes stop rendering, and the restore shows them', async ({
  page,
}) => {
  await page.goto('/zoom.html?flip=on&duration=300');
  await page.getByRole('button', { name: 'Zoom editor' }).click();
  const files = host(page, 'files');
  await expect(files).toHaveAttribute('data-hidden', 'true');
  expect(await files.evaluate((element: HTMLElement) => element.inert)).toBe(
    true
  );
  expect(await flipAnimations(page)).toBe(0);
  expect((await visibility(page)).files).toEqual([true]);
  await page.keyboard.press('Escape');
  await expect(files).not.toHaveAttribute('data-hidden');
  await expect(files).not.toHaveAttribute('aria-hidden');
  await expect(files).toHaveAttribute('tabindex', '0');
  expect((await visibility(page)).files).toEqual([true, false]);
});

test('a collapsed pane under an animated zoom gets no visibility event at the zoom, at the end of its animation, or at the restore', async ({
  page,
}) => {
  await page.goto('/zoom.html?flip=on&duration=300');
  await page.getByRole('button', { name: 'Collapse terminal' }).click();
  await expect(host(page, 'terminal')).toHaveAttribute(
    'data-collapsed',
    'true'
  );
  await expect.poll(() => flipAnimations(page)).toBe(0);
  expect((await visibility(page)).terminal).toEqual([true]);
  await page.getByRole('button', { name: 'Zoom editor' }).click();
  expect((await visibility(page)).terminal).toEqual([true]);
  await expect(host(page, 'terminal')).toHaveAttribute('data-hidden', 'true');
  expect((await visibility(page)).terminal).toEqual([true]);
  await page.getByRole('button', { name: 'Restore editor' }).click();
  await expect(host(page, 'terminal')).not.toHaveAttribute('data-hidden');
  await expect.poll(() => flipAnimations(page)).toBe(0);
  expect((await visibility(page)).terminal).toEqual([true]);
});

test('a hide and a show animate the panes that move', async ({ page }) => {
  await page.goto('/zoom.html?flip=on&duration=1000');
  await command(page, 'setHidden', 'files', true);
  expect(await flipAnimations(page)).toBeGreaterThan(0);
  await command(page, 'setHidden', 'files', false);
  expect(await flipAnimations(page)).toBeGreaterThan(0);
});

test('a user who prefers reduced motion gets no animation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/zoom.html?flip=on&duration=1000');
  await page.getByRole('button', { name: 'Zoom editor' }).click();
  expect(await flipAnimations(page)).toBe(0);
  await expect(host(page, 'files')).toHaveAttribute('data-hidden', 'true');
});
