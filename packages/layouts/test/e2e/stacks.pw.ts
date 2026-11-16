import { expect, type Page, test } from '@playwright/test';

// `stacks()`, `Layout.TabList`, and `Layout.Tab` (demo/stacks.tsx): the APG
// tabs pattern, the keys, the focus, and the tab of a pane outside a stack.

const host = (page: Page, id: string) =>
  page.locator(`[data-layout-pane="${id}"]`);

/** The tab list in the header of the host of a pane. */
const tabsOf = (page: Page, id: string) => host(page, id).getByRole('tablist');

const renders = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() => ({
    ...(window as unknown as { __stacks: { renders: Record<string, number> } })
      .__stacks.renders,
  }));

const command = (page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([name, args]) => {
      const layout = (
        window as unknown as {
          __stacks: { layout: Record<string, (...args: unknown[]) => void> };
        }
      ).__stacks.layout;
      layout[name](...args);
    },
    [name, args] as const
  );

function warningsOf(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  return warnings;
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('the tab list follows the APG tabs pattern', async ({ page }) => {
  await page.goto('/stacks.html');
  const tabs = tabsOf(page, 'main');
  await expect(tabs).toHaveAccessibleName('Tabs of main.ts');
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  const main = tabs.getByRole('tab', { name: 'main.ts' });
  await expect(main).toHaveAttribute('aria-selected', 'true');
  await expect(main).toHaveAttribute('tabindex', '0');
  await expect(main).toHaveAttribute('data-active', 'true');
  const util = tabs.getByRole('tab', { name: 'util.ts' });
  await expect(util).toHaveAttribute('aria-selected', 'false');
  await expect(util).toHaveAttribute('tabindex', '-1');
  // The host of the shown tab is its tab panel, named by the tab.
  await expect(host(page, 'main')).toHaveAttribute('role', 'tabpanel');
  await expect(host(page, 'main')).toHaveAccessibleName('main.ts');
  await expect(main).toHaveAttribute(
    'aria-controls',
    (await host(page, 'main').getAttribute('id')) ?? ''
  );
  await expect(util).toHaveAttribute(
    'aria-controls',
    (await host(page, 'util').getAttribute('id')) ?? ''
  );
});

test('the arrows, Home, and End move the focus to a tab that shows, with no render of other content', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  const before = await renders(page);
  await tabsOf(page, 'main').getByRole('tab', { name: 'main.ts' }).focus();
  await page.keyboard.press('ArrowRight');
  const util = tabsOf(page, 'util').getByRole('tab', { name: 'util.ts' });
  await expect(util).toBeFocused();
  await expect(util).toHaveAttribute('aria-selected', 'true');
  await expect(host(page, 'util')).not.toHaveAttribute('data-pane-hidden');
  await expect(host(page, 'main')).toHaveAttribute('data-pane-hidden', 'true');
  await page.keyboard.press('End');
  await expect(
    tabsOf(page, 'docs').getByRole('tab', { name: 'README.md' })
  ).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(
    tabsOf(page, 'main').getByRole('tab', { name: 'main.ts' })
  ).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Home');
  await expect(
    tabsOf(page, 'main').getByRole('tab', { name: 'main.ts' })
  ).toBeFocused();
  // A change of tab renders no pane content.
  expect(await renders(page)).toEqual(before);
});

test('a click shows a tab and focuses it', async ({ page }) => {
  await page.goto('/stacks.html');
  await tabsOf(page, 'terminal').getByRole('tab', { name: 'Output' }).click();
  const output = tabsOf(page, 'output').getByRole('tab', { name: 'Output' });
  await expect(output).toHaveAttribute('aria-selected', 'true');
  await expect(output).toBeFocused();
});

test('Delete closes the focused tab, and the focus goes to the tab that shows next', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  await tabsOf(page, 'main').getByRole('tab', { name: 'main.ts' }).focus();
  await page.keyboard.press('Delete');
  await expect(host(page, 'main')).toHaveCount(0);
  await expect(tabsOf(page, 'util').getByRole('tab')).toHaveCount(4);
  await expect(
    tabsOf(page, 'util').getByRole('tab', { name: 'util.ts' })
  ).toBeFocused();
});

test('Ctrl+Shift+PageDown and PageUp move the focused tab, which keeps the focus', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  const names = () => tabsOf(page, 'main').getByRole('tab').allTextContents();
  await tabsOf(page, 'main').getByRole('tab', { name: 'main.ts' }).focus();
  await page.keyboard.press('Control+Shift+PageDown');
  await expect
    .poll(names)
    .toEqual(['util.ts', 'main.ts', 'test.ts', 'types.ts', 'README.md']);
  await expect(
    tabsOf(page, 'main').getByRole('tab', { name: 'main.ts' })
  ).toBeFocused();
  await page.keyboard.press('Control+Shift+PageUp');
  await expect
    .poll(names)
    .toEqual(['main.ts', 'util.ts', 'test.ts', 'types.ts', 'README.md']);
});

test('a host of a tab that does not show holds only its own tab', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  const editors = ['main', 'util', 'test', 'types', 'docs'];
  const count = () =>
    page.evaluate(
      (ids) =>
        [...document.querySelectorAll<HTMLElement>('[data-layout-tab]')].filter(
          (tab) => ids.includes(tab.dataset.layoutTab ?? '')
        ).length,
      editors
    );
  // Five tabs in the host that shows, and one in each of the four others.
  expect(await count()).toBe(9);
  for (const id of editors.slice(1))
    await expect(host(page, id).locator('[data-layout-tab]')).toHaveCount(1);
  await tabsOf(page, 'main').getByRole('tab', { name: 'types.ts' }).click();
  await expect(
    tabsOf(page, 'types').getByRole('tab', { name: 'types.ts' })
  ).toBeFocused();
  await expect(tabsOf(page, 'types').getByRole('tab')).toHaveCount(5);
  await expect(host(page, 'main').locator('[data-layout-tab]')).toHaveCount(1);
  expect(await count()).toBe(9);
});

test('a pane outside a stack shows its own tab, and activate focuses it', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  const tabs = tabsOf(page, 'files');
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  const files = tabs.getByRole('tab', { name: 'Files' });
  await expect(files).toHaveAttribute('aria-selected', 'true');
  await expect(host(page, 'files')).toHaveAttribute('role', 'tabpanel');
  await expect(host(page, 'files')).toHaveAccessibleName('Files');
  await command(page, 'activate', 'files');
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __stacks: { layout: { getSnapshot(): { focusedPane: string } } };
          }
        ).__stacks.layout.getSnapshot().focusedPane
    )
  ).toBe('files');
});

test('a hidden tab leaves the tab list', async ({ page }) => {
  await page.goto('/stacks.html');
  await command(page, 'setHidden', 'util', true);
  await expect(tabsOf(page, 'main').getByRole('tab')).toHaveCount(4);
  await expect(
    tabsOf(page, 'main').getByRole('tab', { name: 'util.ts' })
  ).toHaveCount(0);
});

test('a tab list without stacks(), and stacks() without a tab list in a pane, warn', async ({
  page,
}) => {
  const warnings = warningsOf(page);
  await page.goto('/stacks.html?features=nostacks');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(8);
  expect(
    warnings.filter((text) => text.includes('Layout.TabList needs stacks()'))
  ).toHaveLength(1);
  await page.goto('/stacks.html?tablist=none');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(8);
  await expect
    .poll(
      () =>
        warnings.filter((text) =>
          text.includes(
            'Render Layout.TabList in the header of each pane of a stack'
          )
        ).length
    )
    .toBe(1);
});

// The box of a tab in the tab list of the host of a pane.
const tabBox = async (page: Page, host: string, name: string) => {
  const value = await tabsOf(page, host)
    .getByRole('tab', { name })
    .boundingBox();
  if (value === null) throw new Error(`No tab: ${name}`);
  return value;
};

const paneBox = async (page: Page, id: string) => {
  const value = await host(page, id).boundingBox();
  if (value === null) throw new Error(`No pane: ${id}`);
  return value;
};

// Press a tab and move the pointer to a point.
async function dragTab(
  page: Page,
  hostId: string,
  name: string,
  to: { x: number; y: number }
) {
  const from = await tabBox(page, hostId, name);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
}

const names = (page: Page, hostId: string) =>
  tabsOf(page, hostId).getByRole('tab').allTextContents();

test('a tab drag inside its tab list changes the order of the tabs, and the tab keeps the focus', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  const target = await tabBox(page, 'main', 'test.ts');
  await dragTab(page, 'main', 'main.ts', {
    x: target.x + target.width - 4,
    y: target.y + target.height / 2,
  });
  await expect(page.locator('.pierre-layout-tab-drop')).toHaveCount(1);
  await expect(page.locator('.pierre-layout-drop')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('3 panes');
  await page.mouse.up();
  await expect(page.locator('.pierre-layout-tab-drop')).toHaveCount(0);
  await expect
    .poll(() => names(page, 'main'))
    .toEqual(['util.ts', 'test.ts', 'main.ts', 'types.ts', 'README.md']);
  await expect(
    tabsOf(page, 'main').getByRole('tab', { name: 'main.ts' })
  ).toBeFocused();
});

test('a tab drag into another tab list moves the tab into that stack at the place of the drop', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  const terminal = await tabBox(page, 'terminal', 'Terminal');
  await dragTab(page, 'main', 'util.ts', {
    x: terminal.x + terminal.width - 4,
    y: terminal.y + terminal.height / 2,
  });
  await expect(page.getByRole('status')).toHaveText(
    'Move util.ts into the group of Terminal'
  );
  await page.mouse.up();
  await expect
    .poll(() => names(page, 'util'))
    .toEqual(['Terminal', 'util.ts', 'Output']);
  await expect(
    tabsOf(page, 'util').getByRole('tab', { name: 'util.ts' })
  ).toBeFocused();
  await expect.poll(() => names(page, 'main')).toHaveLength(4);
});

test('a tab drag to an edge of a pane takes the tab out of its stack', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  const files = await paneBox(page, 'files');
  await dragTab(page, 'main', 'util.ts', {
    x: files.x + files.width - 8,
    y: files.y + files.height / 2,
  });
  await expect(page.locator('.pierre-layout-drop')).toHaveCount(1);
  await expect(host(page, 'main')).not.toHaveAttribute('data-moving');
  await expect(host(page, 'util')).toHaveAttribute('data-moving', 'true');
  await expect(page.getByRole('status')).toHaveText(
    'Move util.ts to the right of Files'
  );
  await page.mouse.up();
  await expect(page.locator('.pierre-layout-drop')).toHaveCount(0);
  await expect(tabsOf(page, 'util').getByRole('tab')).toHaveCount(1);
  const util = await paneBox(page, 'util');
  expect(util.x).toBeGreaterThan(files.x);
});

test('the center of its own stack takes no drop', async ({ page }) => {
  await page.goto('/stacks.html');
  const main = await paneBox(page, 'main');
  await dragTab(page, 'main', 'main.ts', {
    x: main.x + main.width / 2,
    y: main.y + main.height / 2,
  });
  await expect(page.locator('.pierre-layout-drop')).toHaveCount(0);
  await page.mouse.up();
  await expect
    .poll(() => names(page, 'main'))
    .toEqual(['main.ts', 'util.ts', 'test.ts', 'types.ts', 'README.md']);
});

test('a drag that ends where it started is not a click', async ({ page }) => {
  await page.goto('/stacks.html');
  const util = await tabBox(page, 'main', 'util.ts');
  await dragTab(page, 'main', 'util.ts', {
    x: util.x + util.width / 2 + 8,
    y: util.y + util.height / 2,
  });
  await page.mouse.up();
  await expect(
    tabsOf(page, 'main').getByRole('tab', { name: 'main.ts' })
  ).toHaveAttribute('aria-selected', 'true');
  await expect(host(page, 'util')).toHaveAttribute('data-pane-hidden', 'true');
});

test('while a pane is zoomed, a tab moves only inside its own tab list', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  await command(page, 'setZoom', 'main');
  await expect(host(page, 'main')).toHaveAttribute('data-zoomed', 'true');
  const box = await paneBox(page, 'main');
  await dragTab(page, 'main', 'util.ts', {
    x: box.x + box.width - 8,
    y: box.y + box.height / 2,
  });
  await expect(page.locator('.pierre-layout-drop')).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(() => names(page, 'main')).toHaveLength(5);
  const test = await tabBox(page, 'main', 'test.ts');
  await dragTab(page, 'main', 'util.ts', {
    x: test.x + test.width - 4,
    y: test.y + test.height / 2,
  });
  await page.mouse.up();
  // The moved tab shows, so its host holds the full tab list.
  await expect
    .poll(() => names(page, 'util'))
    .toEqual(['main.ts', 'test.ts', 'util.ts', 'types.ts', 'README.md']);
  await expect(host(page, 'util')).toHaveAttribute('data-zoomed', 'true');
});

// The demo renders under StrictMode, which detaches the ref of a new host and
// attaches it again after the effects of its commit.
test('a tab that a stack gets after the first render shows only when it is active', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  await expect(tabsOf(page, 'main').getByRole('tab')).toHaveCount(5);
  const shown = () =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-layout-pane]:not([data-pane-hidden])'
        ),
      ]
        .filter((element) => !element.inert)
        .map((element) => element.dataset.layoutPane ?? '')
        .sort((a, b) => a.localeCompare(b))
    );
  await command(page, 'addTab', 'main', { type: 'pane', id: 'late' }, 5, {
    activate: false,
  });
  await expect(tabsOf(page, 'main').getByRole('tab')).toHaveCount(6);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve))
  );
  await expect(host(page, 'late')).toHaveAttribute('data-pane-hidden', 'true');
  expect(await shown()).toEqual(['files', 'main', 'terminal']);
  await command(page, 'addTab', 'main', { type: 'pane', id: 'later' });
  await expect(host(page, 'later')).toHaveAttribute('role', 'tabpanel');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve))
  );
  expect(await shown()).toEqual(['files', 'later', 'terminal']);
});
