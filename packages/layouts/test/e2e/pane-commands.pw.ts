import { expect, type Page, test } from '@playwright/test';

// Pane commands without a drag (`DEC-layouts-pane-commands`), in the main
// demo: seven panes in a mosaic, whose tree order is 1, 7, 2, 5, 6, 4, 3.
const ORDER = ['1', '7', '2', '5', '6', '4', '3'];

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('[data-layouts-pane]')).toHaveCount(7);
});

/** The pane whose host holds the focused element, or null. */
const focusedPane = (page: Page): Promise<string | null> =>
  page.evaluate(
    () =>
      document.activeElement
        ?.closest<HTMLElement>('[data-layouts-pane]')
        ?.getAttribute('data-layouts-pane') ?? null
  );

const note = (page: Page, id: string) =>
  page.getByLabel(`Note in Pane ${id}`, { exact: true });

test('A4: F6 visits each pane in tree order and wraps, and Shift+F6 goes back', async ({
  page,
}) => {
  await note(page, '1').focus();
  const visited: (string | null)[] = [];
  for (let step = 0; step < ORDER.length; step++) {
    await page.keyboard.press('F6');
    visited.push(await focusedPane(page));
  }
  expect(visited).toEqual([...ORDER.slice(1), ORDER[0]]);
  const back: (string | null)[] = [];
  for (let step = 0; step < 3; step++) {
    await page.keyboard.press('Shift+F6');
    back.push(await focusedPane(page));
  }
  expect(back).toEqual(['3', '4', '6']);
});

test('F6 gives each pane its last focused element again', async ({ page }) => {
  await note(page, '7').focus();
  await page.keyboard.press('F6');
  expect(await focusedPane(page)).toBe('2');
  await page.keyboard.press('Shift+F6');
  await expect(note(page, '7')).toBeFocused();
  // A pane with no earlier focus gets its content area, which scrolls with
  // the arrow keys.
  await page.keyboard.press('F6');
  await expect(
    page.locator('[data-layouts-pane="2"] .pierre-layouts-content')
  ).toBeFocused();
});

test('F6 follows the tree after a close, and does nothing while a pane is zoomed', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Close Pane 7', exact: true }).click();
  await note(page, '1').focus();
  await page.keyboard.press('F6');
  expect(await focusedPane(page)).toBe('2');
  await page.getByRole('button', { name: 'Zoom Pane 2', exact: true }).click();
  await note(page, '2').focus();
  await page.keyboard.press('F6');
  await expect(note(page, '2')).toBeFocused();
});

test('a canceled focus edge event stops the wrap at each end', async ({
  page,
}) => {
  await page.locator('.pierre-layouts').evaluate((layout) => {
    (window as unknown as { edges: string[] }).edges = [];
    layout.addEventListener('pierre-layouts-focus-edge', (event) => {
      (window as unknown as { edges: string[] }).edges.push(
        (event as CustomEvent<{ direction: string }>).detail.direction
      );
      event.preventDefault();
    });
  });
  await note(page, '3').focus();
  await page.keyboard.press('F6');
  await expect(note(page, '3')).toBeFocused();
  await note(page, '1').focus();
  await page.keyboard.press('Shift+F6');
  await expect(note(page, '1')).toBeFocused();
  // F6 between two panes sends no edge event.
  await page.keyboard.press('F6');
  expect(await focusedPane(page)).toBe('7');
  expect(
    await page.evaluate(() => (window as unknown as { edges: string[] }).edges)
  ).toEqual(['next', 'previous']);
});

test('content that takes every key keeps Tab and Escape, and F6 still leaves it', async ({
  page,
}) => {
  // A terminal or an editor handles each key itself.
  await note(page, '1').evaluate((input) =>
    input.addEventListener('keydown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    })
  );
  await note(page, '1').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(note(page, '1')).toBeFocused();
  await page.keyboard.press('F6');
  expect(await focusedPane(page)).toBe('7');
});

test('no pane host is a Tab stop', async ({ page }) => {
  const stops = await page
    .locator('[data-layouts-pane]')
    .evaluateAll((hosts) =>
      hosts.map((host) => (host as HTMLElement).tabIndex)
    );
  expect(stops).toEqual(ORDER.map(() => -1));
  // Tab from the last control of a header goes into the content of its pane.
  await page
    .locator('[data-layouts-pane="1"]')
    .getByRole('button', { name: 'Close Pane 1', exact: true })
    .focus();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Count in Pane 1', exact: true })
  ).toBeFocused();
});

test('an app command moves the focus to the next pane, with its DOM focus', async ({
  page,
}) => {
  await note(page, '1').focus();
  await page.getByRole('button', { name: 'Next pane', exact: true }).click();
  expect(await focusedPane(page)).toBe('7');
});
