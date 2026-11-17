import { expect, type Page, test } from '@playwright/test';

// The modes of the content of panes that do not show (`hiddenContent`), in
// demo/hidden.tsx: a pane `notes`, a stack of `one` and `two`, and a column of
// `terminal` and `log`. Each pane's content counts the ticks of an interval,
// its mounts, and the visibility events of its host.

interface HiddenPage {
  layout: Record<string, (...args: unknown[]) => void>;
  ticks: Record<string, number>;
  mounts: Record<string, number>;
  events: Record<string, boolean[]>;
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

async function open(page: Page, mode?: string): Promise<void> {
  await page.goto(`/hidden.html${mode === undefined ? '' : `?mode=${mode}`}`);
  await expect(page.locator('[data-layouts-pane]')).toHaveCount(5);
}

const read = (page: Page): Promise<Omit<HiddenPage, 'layout'>> =>
  page.evaluate(() => {
    const { ticks, mounts, events } = (
      window as unknown as { __hidden: HiddenPage }
    ).__hidden;
    return structuredClone({ ticks, mounts, events });
  });

const run = (page: Page, name: string, ...args: unknown[]): Promise<void> =>
  page.evaluate(
    ([name, args]) => {
      (window as unknown as { __hidden: HiddenPage }).__hidden.layout[
        name as string
      ](...(args as unknown[]));
    },
    [name, args]
  );

/** True when the interval of a pane ticks during 150 ms. */
async function ticking(page: Page, id: string): Promise<boolean> {
  const before = (await read(page)).ticks[id] ?? 0;
  await page.waitForTimeout(150);
  return ((await read(page)).ticks[id] ?? 0) > before;
}

const field = (page: Page, id: string) =>
  page.getByLabel(`Field of ${id}`, { exact: true });
const scroll = (page: Page, id: string) =>
  page.getByRole('region', { name: `Scroll of ${id}`, exact: true });

test('by default, the content of a hidden pane stays mounted and keeps running', async ({
  page,
}) => {
  await open(page);
  await expect(page.locator('[data-mode="mounted"]')).toHaveCount(5);
  await run(page, 'setHidden', 'notes', true);
  expect(await ticking(page, 'notes')).toBe(true);
  await run(page, 'setHidden', 'notes', false);
  expect((await read(page)).events.notes).toEqual([true, false]);
});

test('activity: a hidden pane stops its interval, and keeps its state and scroll position when it shows', async ({
  page,
}) => {
  await open(page, 'activity');
  await expect(page.locator('[data-mode="activity"]')).toHaveCount(5);
  await field(page, 'notes').fill('kept');
  await scroll(page, 'notes').evaluate((element) => {
    element.scrollTop = 300;
  });
  expect(await ticking(page, 'notes')).toBe(true);
  await run(page, 'setHidden', 'notes', true);
  expect(await ticking(page, 'notes')).toBe(false);
  await run(page, 'setHidden', 'notes', false);
  await expect(field(page, 'notes')).toHaveValue('kept');
  expect(
    await scroll(page, 'notes').evaluate((element) => element.scrollTop)
  ).toBe(300);
  expect(await ticking(page, 'notes')).toBe(true);
  const state = await read(page);
  expect(state.mounts.notes).toBe(1);
  // The content hears the hide, then its effects clean up; they run again
  // when it shows, in place of the event of the show.
  expect(state.events.notes).toEqual([true]);
});

test('activity: an inactive tab waits from its first render, and runs while it shows', async ({
  page,
}) => {
  await open(page, 'activity');
  expect(await ticking(page, 'two')).toBe(false);
  await run(page, 'activate', 'two');
  expect(await ticking(page, 'two')).toBe(true);
  expect(await ticking(page, 'one')).toBe(false);
  await run(page, 'activate', 'one');
  expect(await ticking(page, 'two')).toBe(false);
  expect((await read(page)).mounts).toMatchObject({ one: 1, two: 1 });
});

test('activity: a pane under a zoom waits, and runs again at the restore', async ({
  page,
}) => {
  await open(page, 'activity');
  await run(page, 'setZoom', 'notes');
  await expect(page.locator('[data-layouts-pane="terminal"]')).toHaveAttribute(
    'data-covered',
    'zoom'
  );
  expect(await ticking(page, 'terminal')).toBe(false);
  expect(await ticking(page, 'notes')).toBe(true);
  await run(page, 'setZoom', null);
  expect(await ticking(page, 'terminal')).toBe(true);
  expect((await read(page)).mounts.terminal).toBe(1);
});

test('unmount: a hidden pane unmounts, and its content mounts again when it shows', async ({
  page,
}) => {
  await open(page, 'unmount');
  await field(page, 'notes').fill('lost');
  await run(page, 'setHidden', 'notes', true);
  await expect(field(page, 'notes')).toHaveCount(0);
  expect(await ticking(page, 'notes')).toBe(false);
  await run(page, 'setHidden', 'notes', false);
  await expect(field(page, 'notes')).toHaveValue('');
  expect(
    await scroll(page, 'notes').evaluate((element) => element.scrollTop)
  ).toBe(0);
  const state = await read(page);
  expect(state.mounts.notes).toBe(2);
  // The content hears the hide before it unmounts.
  expect(state.events.notes).toEqual([true]);
});

test('unmount: an inactive tab mounts only while it shows', async ({
  page,
}) => {
  await open(page, 'unmount');
  await expect(field(page, 'two')).toHaveCount(0);
  expect((await read(page)).mounts.two).toBeUndefined();
  await run(page, 'activate', 'two');
  await expect(field(page, 'two')).toHaveCount(1);
  await expect(field(page, 'one')).toHaveCount(0);
  expect((await read(page)).mounts).toMatchObject({ one: 1, two: 1 });
  // The host of the hidden tab stays, so its tab still controls it.
  await expect(page.locator('[data-layouts-pane="one"]')).toHaveCount(1);
});

test('unmount: the panes under a zoom unmount, and mount again at the restore', async ({
  page,
}) => {
  await open(page, 'unmount');
  await run(page, 'setZoom', 'notes');
  await expect(field(page, 'terminal')).toHaveCount(0);
  await expect(field(page, 'notes')).toHaveCount(1);
  await run(page, 'setZoom', null);
  await expect(field(page, 'terminal')).toHaveCount(1);
  expect((await read(page)).mounts.terminal).toBe(2);
});

test('a function chooses the mode of each pane by the kind of its content', async ({
  page,
}) => {
  await open(page, 'kinds');
  await expect(
    page.locator('[data-layouts-pane="terminal"] [data-mode]')
  ).toHaveAttribute('data-mode', 'mounted');
  await expect(
    page.locator('[data-layouts-pane="notes"] [data-mode]')
  ).toHaveAttribute('data-mode', 'activity');
  for (const id of ['terminal', 'notes', 'log'])
    await run(page, 'setHidden', id, true);
  expect(await ticking(page, 'terminal')).toBe(true);
  expect(await ticking(page, 'notes')).toBe(false);
  await expect(field(page, 'log')).toHaveCount(0);
});

test('a collapse to the header keeps the header, and the content of Layout.Content follows the mode', async ({
  page,
}) => {
  const header = (id: string) =>
    page.locator(`[data-layouts-pane="${id}"] .pierre-layouts-header`);
  // Mounted: the collapsed content keeps running.
  await open(page);
  await run(page, 'setCollapsed', 'log', true);
  expect(await ticking(page, 'log')).toBe(true);
  // Activity: it waits, with its state, and the header stays.
  await open(page, 'activity');
  await field(page, 'log').fill('kept');
  await run(page, 'setCollapsed', 'log', true);
  await expect(header('log')).toBeVisible();
  expect(await ticking(page, 'log')).toBe(false);
  await run(page, 'setCollapsed', 'log', false);
  await expect(field(page, 'log')).toHaveValue('kept');
  expect(await ticking(page, 'log')).toBe(true);
  // Unmount: the content unmounts, and the header stays.
  await open(page, 'unmount');
  await run(page, 'setCollapsed', 'log', true);
  await expect(header('log')).toBeVisible();
  await expect(field(page, 'log')).toHaveCount(0);
  await run(page, 'setCollapsed', 'log', false);
  await expect(field(page, 'log')).toHaveCount(1);
  expect((await read(page)).mounts.log).toBe(2);
});

for (const mode of [undefined, 'activity', 'unmount']) {
  test(`${mode ?? 'mounted'}: a tab that does not show needs no tab list, so no warning comes`, async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await open(page, mode);
    await page.getByRole('tab', { name: 'two', exact: true }).click();
    await expect(page.locator('[data-layouts-pane="two"]')).toHaveAttribute(
      'role',
      'tabpanel'
    );
    await page.getByRole('tab', { name: 'one', exact: true }).click();
    await expect(page.locator('[data-layouts-pane="one"]')).toHaveAttribute(
      'role',
      'tabpanel'
    );
    expect(warnings.filter((text) => text.includes('Layout.TabList'))).toEqual(
      []
    );
  });
}
