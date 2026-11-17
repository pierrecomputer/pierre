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

test('a keymap rebinds a command, removes a binding, and binds a command with no default key', async ({
  page,
}) => {
  await page.goto('/?keymap=rebound');
  await expect(page.locator('[data-layouts-pane]')).toHaveCount(7);
  // F6 now reaches the content.
  await note(page, '1').evaluate((input) => {
    (window as unknown as { f6: number }).f6 = 0;
    input.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'F6')
        (window as unknown as { f6: number }).f6 += 1;
    });
  });
  await note(page, '1').focus();
  await page.keyboard.press('F6');
  await expect(note(page, '1')).toBeFocused();
  expect(
    await page.evaluate(() => (window as unknown as { f6: number }).f6)
  ).toBe(1);
  await page.keyboard.press('Alt+Shift+ArrowRight');
  expect(await focusedPane(page)).toBe('7');
  // `focus.previous` has no key.
  await page.keyboard.press('Shift+F6');
  expect(await focusedPane(page)).toBe('7');
  // `zoom.toggle` zooms the focused pane, outside a text field.
  await page.locator('[data-layouts-pane="7"] .pierre-layouts-content').focus();
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect(page.locator('[data-layouts-pane="7"]')).toHaveAttribute(
    'data-zoomed',
    'true'
  );
});

test('Escape restores the zoom outside a text field only', async ({ page }) => {
  await page.getByRole('button', { name: 'Zoom Pane 1', exact: true }).click();
  const host = page.locator('[data-layouts-pane="1"]');
  await note(page, '1').focus();
  await page.keyboard.press('Escape');
  await expect(host).toHaveAttribute('data-zoomed', 'true');
  await page
    .getByRole('button', { name: 'Count in Pane 1', exact: true })
    .focus();
  await page.keyboard.press('Escape');
  await expect(host).not.toHaveAttribute('data-zoomed');
});

const handle = (page: Page, id: string) =>
  page.locator(`[data-layouts-pane="${id}"] .pierre-layouts-grip`);
const status = (page: Page) =>
  page.locator('.pierre-layouts > [role="status"]');
const box = async (page: Page, id: string) => {
  const value = await page.locator(`[data-layouts-pane="${id}"]`).boundingBox();
  if (value === null) throw new Error(`No box: ${id}`);
  return value;
};
const item = (page: Page, name: string) =>
  page.getByRole('menuitem', { name, exact: true });

test('A7: single clicks move a pane to each edge of another pane, with no drag', async ({
  page,
}) => {
  const places: [
    string,
    string,
    (one: { x: number; y: number }, three: { x: number; y: number }) => boolean,
  ][] = [
    ['left of', 'Left of', (one, three) => one.x < three.x],
    ['right of', 'Right of', (one, three) => one.x > three.x],
    ['above', 'Above', (one, three) => one.y < three.y],
    ['below', 'Below', (one, three) => one.y > three.y],
  ];
  for (const [phrase, place, check] of places) {
    // A press and release with no move between them opens the menu. A place
    // beside a neighbor is a top-level item; "Move to…" holds the others,
    // each once.
    await handle(page, '1').click();
    const near = item(page, `Move ${phrase} Pane 3`);
    if ((await near.count()) > 0) await near.click();
    else {
      await item(page, 'Move to…').click();
      await item(page, `${place} Pane 3`).click();
    }
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(status(page)).toContainText('Pane 1 moved to the');
    expect(check(await box(page, '1'), await box(page, '3'))).toBe(true);
    // The focus goes back to the trigger.
    await expect(handle(page, '1')).toBeFocused();
  }
});

test('B4: the keyboard alone moves a pane beside another, to a new column, and into tabs', async ({
  page,
}) => {
  await handle(page, '1').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  // The first item has the focus; the arrows move to "Move below Pane 7".
  await expect(item(page, 'Move right of Pane 2')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Move below Pane 7')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Pane 1 moved to the bottom of Pane 7');
  await expect(handle(page, '1')).toBeFocused();
  expect((await box(page, '1')).y).toBeGreaterThan((await box(page, '7')).y);
  // A new column at the right of the layout.
  await page.keyboard.press('ArrowDown');
  await item(page, 'Move to a new column at the right').focus();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(
    'Pane 1 moved to a new column at the right'
  );
  await expect(page.locator('[data-layouts-pane="1"]')).toHaveAttribute(
    'data-edges',
    'top right bottom'
  );
  // Into the tabs of a neighbor, from "Move to…" with Arrow Right.
  await page.keyboard.press('Enter');
  await item(page, 'Move to…').focus();
  await page.keyboard.press('ArrowRight');
  await item(page, 'Tabs of Pane 2').focus();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(
    'Pane 1 moved into the group of Pane 2'
  );
  await expect(page.locator('[data-layouts-pane="2"]')).toHaveAttribute(
    'role',
    'tabpanel'
  );
  // Escape closes the menu and gives the focus back.
  await handle(page, '1').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(handle(page, '1')).toBeFocused();
});

test('Grow and Shrink step a pane by 10% of its split, and stop at a limit', async ({
  page,
}) => {
  const width = async () => (await box(page, '1')).width;
  const before = await width();
  await handle(page, '1').click();
  await item(page, 'Wider').click();
  await expect(status(page)).toHaveText(/^Pane 1 width \d+%$/);
  const after = await width();
  const space =
    (await page.locator('.pierre-layouts').boundingBox())?.width ?? 0;
  expect(after - before).toBeGreaterThan(space * 0.08);
  await handle(page, '1').click();
  await item(page, 'Narrower').click();
  expect(Math.abs((await width()) - before)).toBeLessThan(2);
  // Narrower until the pane has its minimum size: the item is disabled.
  for (let step = 0; step < 8; step++) {
    await handle(page, '1').click();
    const narrower = item(page, 'Narrower');
    if ((await narrower.getAttribute('aria-disabled')) === 'true') break;
    await narrower.click();
  }
  await expect(item(page, 'Narrower')).toHaveAttribute('aria-disabled', 'true');
  await expect(item(page, 'Wider')).not.toHaveAttribute('aria-disabled');
});

test('directional focus and Grow run from keys that the keymap binds', async ({
  page,
}) => {
  await page.goto('/?keymap=rebound');
  await expect(page.locator('[data-layouts-pane]')).toHaveCount(7);
  await page.locator('[data-layouts-pane="1"] .pierre-layouts-content').focus();
  await page.keyboard.press('Alt+Shift+ArrowDown');
  expect(await focusedPane(page)).toBe('7');
  const before = (await box(page, '7')).width;
  await page.keyboard.press('Alt+Shift+W');
  expect((await box(page, '7')).width).toBeGreaterThan(before);
});

test('while a pane is zoomed, the move and size items are disabled and Restore stays', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Zoom Pane 1', exact: true }).click();
  await handle(page, '1').click();
  await expect(item(page, 'Move below Pane 7')).toHaveAttribute(
    'aria-disabled',
    'true'
  );
  await expect(item(page, 'Wider')).toHaveAttribute('aria-disabled', 'true');
  await item(page, 'Restore').click();
  await expect(page.locator('[data-layouts-pane="1"]')).not.toHaveAttribute(
    'data-zoomed'
  );
});

test('with arrange(), the move handle is the trigger of the pane menu', async ({
  page,
}) => {
  const trigger = page
    .locator('[data-layouts-pane="1"]')
    .getByRole('button', { name: 'Arrange Pane 1', exact: true });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menu')).toHaveAccessibleName('Arrange Pane 1');
  // A drag of the same handle still moves the pane.
  await page.keyboard.press('Escape');
  const from = await trigger.boundingBox();
  const to = await box(page, '3');
  if (from === null) throw new Error('No box');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 8, to.y + to.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect((await box(page, '1')).x).toBeGreaterThan(to.x);
});

test("one rule for places: the layout's canPlace hides the menu items that it refuses, and refuses the drag", async ({
  page,
}) => {
  // The rule refuses every place at a left edge.
  await page.goto('/?refuse=left');
  await expect(page.locator('[data-layouts-pane]')).toHaveCount(7);
  await handle(page, '2').click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(item(page, 'Move right of Pane 5')).toHaveCount(1);
  await expect(item(page, 'Move to a new column at the right')).toHaveCount(1);
  await expect(item(page, 'Move to a new column at the left')).toHaveCount(0);
  await expect(
    menu.getByRole('menuitem', { name: /^Move left of / })
  ).toHaveCount(0);
  await item(page, 'Move to…').click();
  await expect(page.getByRole('menuitem', { name: /^Left of / })).toHaveCount(
    0
  );
  await expect(
    page.getByRole('menuitem', { name: 'Right of Pane 3' })
  ).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // A drag to the left edge of pane 3 shows no marker and does not move.
  const from = await handle(page, '2').boundingBox();
  const three = await box(page, '3');
  if (from === null) throw new Error('No box');
  const before = await box(page, '2');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(three.x + 6, three.y + three.height / 2, { steps: 8 });
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(0);
  await page.mouse.up();
  expect(await box(page, '2')).toEqual(before);
});
