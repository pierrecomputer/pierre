import { expect, type Page, test } from '@playwright/test';

// The cover API with the app's own overlays (demo/cover.tsx): a native
// `<dialog>` with `showModal()` and `Layout.useCover`, and a popover of the
// page with `coverLayout`.

const host = (page: Page, id: string) =>
  page.locator(`[data-layouts-pane="${id}"]`);

const read = (page: Page) =>
  page.evaluate(() => {
    const value = (
      window as unknown as {
        __cover: {
          visibility: Record<string, boolean[]>;
          covers: { covered: string[]; overlapped: string[] }[];
        };
      }
    ).__cover;
    return { visibility: value.visibility, covers: value.covers };
  });

const call = (page: Page, name: 'openPopover' | 'closePopover') =>
  page.evaluate(
    (name) =>
      (
        window as unknown as {
          __cover: Record<string, () => void>;
        }
      ).__cover[name](),
    name
  );

const hidden = (page: Page, id: string) =>
  host(page, id).evaluate(
    (element: HTMLElement) =>
      element.inert && element.dataset.covered === 'overlay'
  );

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/cover.html');
  await expect(page.locator('[data-layouts-pane]')).toHaveCount(4);
});

test('a modal dialog of the app covers the panes in its box, which stop rendering and send one event each way', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Open the dialog' }).click();
  await expect(host(page, 'a')).toHaveAttribute('data-covered', 'overlay');
  expect(await hidden(page, 'a')).toBe(true);
  expect(await hidden(page, 'b')).toBe(true);
  await expect(host(page, 'a')).toHaveCSS('content-visibility', 'hidden');
  expect(await hidden(page, 'c')).toBe(false);
  await page.getByRole('button', { name: 'Close the dialog' }).click();
  await expect(host(page, 'a')).not.toHaveAttribute('data-covered');
  expect(await hidden(page, 'a')).toBe(false);
  const { visibility } = await read(page);
  expect(visibility).toEqual({ a: [true, false], b: [true, false] });
});

test('a pane under two overlays shows again only after both release it', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Open the dialog' }).click();
  await expect(host(page, 'b')).toHaveAttribute('data-covered', 'overlay');
  await call(page, 'openPopover');
  await expect(host(page, 'c')).toHaveAttribute('data-covered', 'overlay');
  // The popover reports the panes in its box and the panes that it crosses.
  await expect
    .poll(async () => (await read(page)).covers.at(-1))
    .toEqual({ covered: ['b', 'c'], overlapped: [] });
  await page.keyboard.press('Escape');
  await expect(host(page, 'a')).not.toHaveAttribute('data-covered');
  // The popover still covers the second pane.
  expect(await hidden(page, 'b')).toBe(true);
  await call(page, 'closePopover');
  await expect(host(page, 'b')).not.toHaveAttribute('data-covered');
  expect(await hidden(page, 'b')).toBe(false);
  const { visibility, covers } = await read(page);
  expect(visibility.b).toEqual([true, false]);
  expect(visibility.c).toEqual([true, false]);
  expect(covers.at(-1)).toEqual({ covered: [], overlapped: [] });
});

test('a covered pane that is also hidden sends no event for the second reason', async ({
  page,
}) => {
  await call(page, 'openPopover');
  await expect(host(page, 'c')).toHaveAttribute('data-covered', 'overlay');
  await page.evaluate(() =>
    (
      window as unknown as {
        __cover: { layout: { setHidden(id: string, hidden: boolean): void } };
      }
    ).__cover.layout.setHidden('c', true)
  );
  await expect(host(page, 'c')).toHaveAttribute('data-hidden', 'true');
  await call(page, 'closePopover');
  await expect(host(page, 'c')).not.toHaveAttribute('data-covered');
  expect(
    await host(page, 'c').evaluate((element: HTMLElement) => element.inert)
  ).toBe(true);
  expect((await read(page)).visibility.c).toEqual([true]);
});
