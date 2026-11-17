import { expect, type Page, test } from '@playwright/test';

// `stacks()`, `Layout.TabList`, and `Layout.Tab` (demo/stacks.tsx): the APG
// tabs pattern, the keys, the focus, and the tab of a pane outside a stack.

const host = (page: Page, id: string) =>
  page.locator(`[data-layouts-pane="${id}"]`);

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

test('with a title and a tab list, the tab names the host, and the title names it when the tab list goes', async ({
  page,
}) => {
  await page.goto('/stacks.html?title=1');
  const main = host(page, 'main');
  const tab = tabsOf(page, 'main').getByRole('tab', { name: 'main.ts' });
  const heading = main.getByRole('heading', { name: 'main.ts', exact: true });
  const tabId = (await tab.getAttribute('id')) ?? 'a tab with an id';
  const headingId =
    (await heading.getAttribute('id')) ?? 'a heading with an id';
  await expect(main).toHaveAttribute('role', 'tabpanel');
  await expect(main).toHaveAttribute('aria-labelledby', tabId);
  const toggle = page.getByRole('button', { name: 'Hide the tab lists' });
  await toggle.click();
  await expect(tabsOf(page, 'main')).toHaveCount(0);
  await expect(main).not.toHaveAttribute('role');
  await expect(main).toHaveAttribute('aria-labelledby', headingId);
  await expect(main).toHaveAccessibleName('main.ts');
  await toggle.click();
  await expect(main).toHaveAttribute('role', 'tabpanel');
  await expect(main).toHaveAttribute('aria-labelledby', tabId);
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
  await expect(host(page, 'util')).not.toHaveAttribute('data-hidden');
  await expect(host(page, 'main')).toHaveAttribute('data-hidden', 'true');
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

test('a field or a button inside a tab keeps its own keys', async ({
  page,
}) => {
  await page.goto('/stacks.html?nested=1');
  const tabs = tabsOf(page, 'main');
  const order = () =>
    tabs
      .getByRole('tab')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-layouts-tab'))
      );
  const before = await order();
  const keys = [
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'Delete',
    'Control+Shift+PageUp',
  ];
  // A tab's children are presentational, so the controls are found by their
  // elements, as an app would render them.
  const field = tabs.locator('input[aria-label="Name of README.md"]');
  const button = tabs.locator('button', { hasText: 'Pin README.md' });
  for (const control of [field, button]) {
    await control.focus();
    for (const key of keys) await page.keyboard.press(key);
    await expect(control).toBeFocused();
    await expect(tabs.getByRole('tab', { name: 'main.ts' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(host(page, 'docs')).toHaveCount(1);
    expect(await order()).toEqual(before);
  }
  // Delete removed a character of the field: the field got its keys.
  await expect(field).not.toHaveValue('README.md');
  await field.fill('README.md');
  await page.keyboard.press('End');
  await page.keyboard.type('.bak');
  await expect(field).toHaveValue('README.md.bak');
  // The tab element itself keeps the keys of the tabs pattern.
  await tabs.getByRole('tab', { name: 'main.ts' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    tabsOf(page, 'util').getByRole('tab', { name: 'util.ts' })
  ).toBeFocused();
});

test('a host of a tab that does not show holds only its own tab', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  const editors = ['main', 'util', 'test', 'types', 'docs'];
  const count = () =>
    page.evaluate(
      (ids) =>
        [
          ...document.querySelectorAll<HTMLElement>('[data-layouts-tab]'),
        ].filter((tab) => ids.includes(tab.dataset.layoutsTab ?? '')).length,
      editors
    );
  // Five tabs in the host that shows, and one in each of the four others.
  expect(await count()).toBe(9);
  for (const id of editors.slice(1))
    await expect(host(page, id).locator('[data-layouts-tab]')).toHaveCount(1);
  await tabsOf(page, 'main').getByRole('tab', { name: 'types.ts' }).click();
  await expect(
    tabsOf(page, 'types').getByRole('tab', { name: 'types.ts' })
  ).toBeFocused();
  await expect(tabsOf(page, 'types').getByRole('tab')).toHaveCount(5);
  await expect(host(page, 'main').locator('[data-layouts-tab]')).toHaveCount(1);
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
  await expect(page.locator('[data-layouts-pane]')).toHaveCount(8);
  expect(
    warnings.filter((text) => text.includes('Layout.TabList needs stacks()'))
  ).toHaveLength(1);
  await page.goto('/stacks.html?tablist=none');
  await expect(page.locator('[data-layouts-pane]')).toHaveCount(8);
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

// The order of the editors stack, from the store: the host that shows can
// change at a drop.
const editorsOrder = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    type Node = { id: string; children?: Node[] };
    const root = (
      window as unknown as {
        __stacks: { layout: { getSnapshot(): { root: Node } } };
      }
    ).__stacks.layout.getSnapshot().root;
    const editors = root.children?.find((node) => node.id === 'editors');
    return editors?.children?.map((node) => node.id) ?? [];
  });

// The order of a stack, from the store.
const stackOrder = (page: Page, id: string): Promise<string[]> =>
  page.evaluate((id) => {
    type Node = { id: string; children?: Node[] };
    const find = (node: Node): Node | undefined =>
      node.id === id ? node : node.children?.map(find).find(Boolean);
    const root = (
      window as unknown as {
        __stacks: { layout: { getSnapshot(): { root: Node } } };
      }
    ).__stacks.layout.getSnapshot().root;
    return find(root)?.children?.map((node) => node.id) ?? [];
  }, id);

test('a tab drag inside its tab list changes the order of the tabs, and the tab keeps the focus', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  const target = await tabBox(page, 'main', 'test.ts');
  await dragTab(page, 'main', 'main.ts', {
    x: target.x + target.width - 4,
    y: target.y + target.height / 2,
  });
  await expect(page.locator('.pierre-layouts-tab-drop')).toHaveCount(1);
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('');
  await page.mouse.up();
  await expect(page.locator('.pierre-layouts-tab-drop')).toHaveCount(0);
  await expect
    .poll(() => names(page, 'main'))
    .toEqual(['util.ts', 'test.ts', 'main.ts', 'types.ts', 'README.md']);
  await expect(
    tabsOf(page, 'main').getByRole('tab', { name: 'main.ts' })
  ).toBeFocused();
});

test('a press in a field or a button inside a tab drags no tab, and a press on the tab drags it', async ({
  page,
}) => {
  await page.goto('/stacks.html?nested=1');
  const tabs = tabsOf(page, 'main');
  // The order of the editors stack, from the store: the host that shows can
  // change at the drop.
  const order = () =>
    page.evaluate(() => {
      type Node = { id: string; children?: Node[] };
      const root = (
        window as unknown as {
          __stacks: { layout: { getSnapshot(): { root: Node } } };
        }
      ).__stacks.layout.getSnapshot().root;
      const editors = root.children?.find((node) => node.id === 'editors');
      return editors?.children?.map((node) => node.id) ?? [];
    });
  const target = await tabBox(page, 'main', 'util.ts');
  const to = { x: target.x + 4, y: target.y + target.height / 2 };
  const controls = [
    tabs.locator('input[aria-label="Name of README.md"]'),
    tabs.locator('button', { hasText: 'Pin README.md' }),
  ];
  for (const control of controls) {
    const box = await control.boundingBox();
    if (box === null) throw new Error('No box for the control');
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await expect(page.locator('.pierre-layouts-tab-drop')).toHaveCount(0);
    await page.mouse.up();
    expect(await order()).toEqual(['main', 'util', 'test', 'types', 'docs']);
  }
  // A press on the text of the tab is the tab's own: it drags the tab.
  const label = tabs.locator('[data-layouts-tab="docs"] > span');
  const box = await label.boundingBox();
  if (box === null) throw new Error('No box for the label');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(page.locator('.pierre-layouts-tab-drop')).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(order).toEqual(['main', 'docs', 'util', 'test', 'types']);
});

test('a tab list outside Layout.Header takes none of the header geometry', async ({
  page,
}) => {
  const geometry = () =>
    tabsOf(page, 'main').evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.marginTop, style.overflowX, style.flexGrow];
    });
  await page.goto('/stacks.html?header=none');
  expect(await geometry()).toEqual(['0px', 'visible', '0']);
  await page.goto('/stacks.html');
  expect(await geometry()).toEqual(['-4px', 'hidden', '1']);
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
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(1);
  await expect(host(page, 'main')).not.toHaveAttribute('data-moving');
  await expect(host(page, 'util')).toHaveAttribute('data-moving', 'true');
  await expect(page.getByRole('status')).toHaveText(
    'Move util.ts to the right of Files'
  );
  await page.mouse.up();
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(0);
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
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(0);
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
  await expect(host(page, 'util')).toHaveAttribute('data-hidden', 'true');
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
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(0);
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
          '[data-layouts-pane]:not([data-hidden])'
        ),
      ]
        .filter((element) => !element.inert)
        .map((element) => element.dataset.layoutsPane ?? '')
        .sort((a, b) => a.localeCompare(b))
    );
  await command(page, 'addTab', 'main', { type: 'pane', id: 'late' }, 5, {
    activate: false,
  });
  await expect(tabsOf(page, 'main').getByRole('tab')).toHaveCount(6);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve))
  );
  await expect(host(page, 'late')).toHaveAttribute('data-hidden', 'true');
  expect(await shown()).toEqual(['files', 'main', 'terminal']);
  await command(page, 'addTab', 'main', { type: 'pane', id: 'later' });
  await expect(host(page, 'later')).toHaveAttribute('role', 'tabpanel');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve))
  );
  expect(await shown()).toEqual(['files', 'later', 'terminal']);
});

test("an app's handler that calls preventDefault() stops the tab's own handler", async ({
  page,
}) => {
  await page.goto('/stacks.html?guard=1');
  const tabs = tabsOf(page, 'main');
  const main = tabs.getByRole('tab', { name: 'main.ts' });
  await main.focus();
  await page.keyboard.press('Delete');
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  await expect(host(page, 'main')).toHaveCount(1);
  // The arrows have no app handler: the tab still moves the focus.
  await page.keyboard.press('ArrowRight');
  const util = tabsOf(page, 'util').getByRole('tab', { name: 'util.ts' });
  await expect(util).toBeFocused();
  await expect(util).toHaveAttribute('aria-selected', 'true');
  // A prevented click selects nothing.
  await tabsOf(page, 'util').getByRole('tab', { name: 'test.ts' }).click();
  await expect(util).toHaveAttribute('aria-selected', 'true');
  // A prevented press starts no drag; a press on another tab does.
  const target = await tabBox(page, 'util', 'main.ts');
  const to = { x: target.x + 4, y: target.y + target.height / 2 };
  await dragTab(page, 'util', 'types.ts', to);
  await expect(page.locator('.pierre-layouts-tab-drop')).toHaveCount(0);
  await page.mouse.up();
  expect(await editorsOrder(page)).toEqual([
    'main',
    'util',
    'test',
    'types',
    'docs',
  ]);
  await dragTab(page, 'util', 'README.md', to);
  await expect(page.locator('.pierre-layouts-tab-drop')).toHaveCount(1);
  await page.mouse.up();
  await expect
    .poll(() => editorsOrder(page))
    .toEqual(['docs', 'main', 'util', 'test', 'types']);
});

test('pinned tabs stay first: key moves and drags clamp to the pinned run, in their stack and in another', async ({
  page,
}) => {
  await page.goto('/stacks.html?pinned=1');
  const tabs = tabsOf(page, 'main');
  const tab = (name: string) => tabs.getByRole('tab', { name });
  await expect(tab('main.ts')).toHaveAttribute('data-pinned', 'true');
  await expect(tab('main.ts')).toHaveAccessibleDescription('Pinned');
  await expect(tab('test.ts')).not.toHaveAttribute('data-pinned');
  const start = ['main', 'util', 'test', 'types', 'docs'];
  // Ctrl+Shift+PageUp on the first tab after the run, and PageDown on the
  // last pinned tab, move nothing.
  await tab('test.ts').click();
  await page.keyboard.press('Control+Shift+PageUp');
  await tabsOf(page, 'test').getByRole('tab', { name: 'util.ts' }).focus();
  await page.keyboard.press('Control+Shift+PageDown');
  expect(await editorsOrder(page)).toEqual(start);
  // Inside the run, a key move works.
  await page.keyboard.press('Control+Shift+PageUp');
  await expect
    .poll(() => editorsOrder(page))
    .toEqual(['util', 'main', 'test', 'types', 'docs']);
  // A drag of a tab before the pinned tabs shows the marker at the end of
  // the run, and drops there.
  await tabsOf(page, 'util').getByRole('tab', { name: 'test.ts' }).click();
  const list = tabsOf(page, 'test');
  const first = await tabBox(page, 'test', 'util.ts');
  const after = await list.getByRole('tab', { name: 'test.ts' }).boundingBox();
  if (after === null) throw new Error('No box for test.ts');
  await dragTab(page, 'test', 'types.ts', {
    x: first.x + 4,
    y: first.y + first.height / 2,
  });
  const marker = page.locator('.pierre-layouts-tab-drop');
  await expect(marker).toHaveCount(1);
  const mark = await marker.boundingBox();
  expect(Math.abs((mark?.x ?? 0) - after.x)).toBeLessThan(4);
  await page.mouse.up();
  await expect
    .poll(() => editorsOrder(page))
    .toEqual(['util', 'main', 'types', 'test', 'docs']);
  // A pinned tab drops into another tab list at the end of its pinned run,
  // which is the start of a list with no pinned tab, and stays pinned.
  const terminal = await tabBox(page, 'terminal', 'Terminal');
  const output = await tabBox(page, 'terminal', 'Output');
  await dragTab(page, 'types', 'main.ts', {
    x: output.x + output.width - 4,
    y: output.y + output.height / 2,
  });
  await expect(marker).toHaveCount(1);
  const mark2 = await marker.boundingBox();
  expect(Math.abs((mark2?.x ?? 0) - terminal.x)).toBeLessThan(4);
  await page.mouse.up();
  await expect
    .poll(() => stackOrder(page, 'tools'))
    .toEqual(['main', 'terminal', 'output']);
  expect(await editorsOrder(page)).toEqual(['util', 'types', 'test', 'docs']);
  const moved = tabsOf(page, 'main').getByRole('tab', { name: 'main.ts' });
  await expect(moved).toHaveAttribute('data-pinned', 'true');
  // And to an edge of another pane, beside it, still pinned.
  const files = await host(page, 'files').boundingBox();
  if (files === null) throw new Error('No box for files');
  await dragTab(page, 'main', 'main.ts', {
    x: files.x + files.width / 2,
    y: files.y + files.height / 2,
  });
  await page.mouse.move(files.x + 4, files.y + files.height / 2, { steps: 4 });
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(1);
  await page.mouse.up();
  await expect
    .poll(() => stackOrder(page, 'tools'))
    .toEqual(['terminal', 'output']);
  await expect(
    tabsOf(page, 'main').getByRole('tab', { name: 'main.ts' })
  ).toHaveAttribute('data-pinned', 'true');
  const main = await host(page, 'main').boundingBox();
  const filesAfter = await host(page, 'files').boundingBox();
  expect((main?.x ?? 0) + (main?.width ?? 0)).toBeLessThanOrEqual(
    (filesAfter?.x ?? 0) + 1
  );
});

test('a tab that is not closable keeps Delete and its close button from closing it, and the app still closes it', async ({
  page,
}) => {
  await page.goto('/stacks.html?pinned=1');
  const docs = tabsOf(page, 'main').getByRole('tab', { name: 'README.md' });
  await docs.click();
  await page.keyboard.press('Delete');
  await expect(host(page, 'docs')).toHaveCount(1);
  await expect(
    host(page, 'docs').getByRole('button', { name: 'Close README.md' })
  ).toBeDisabled();
  await command(page, 'close', 'docs');
  await expect(host(page, 'docs')).toHaveCount(0);
  // A pinned tab closes as any tab does.
  await tabsOf(page, 'types').getByRole('tab', { name: 'main.ts' }).click();
  await page.keyboard.press('Delete');
  await expect(host(page, 'main')).toHaveCount(0);
});

test('with manual activation, the arrows move the focus only, and Enter or Space selects', async ({
  page,
}) => {
  await page.goto('/stacks.html?activation=manual');
  await page.evaluate(() => {
    const target = window as unknown as {
      __stacks: { layout: { subscribe(listener: () => void): () => void } };
      __changes: number;
    };
    target.__changes = 0;
    target.__stacks.layout.subscribe(() => {
      target.__changes += 1;
    });
  });
  const changes = () =>
    page.evaluate(() => (window as unknown as { __changes: number }).__changes);
  const tabs = tabsOf(page, 'main');
  const tab = (name: string) => tabs.getByRole('tab', { name });
  await tab('main.ts').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab('util.ts')).toBeFocused();
  await expect(tab('main.ts')).toHaveAttribute('aria-selected', 'true');
  await expect(tab('main.ts')).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('End');
  await expect(tab('README.md')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab('main.ts')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab('README.md')).toBeFocused();
  expect(await changes()).toBe(0);
  // Tab leaves the list, and Shift+Tab comes back to the selected tab.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(tab('main.ts')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const util = tabsOf(page, 'util').getByRole('tab', { name: 'util.ts' });
  await expect(util).toHaveAttribute('aria-selected', 'true');
  await expect(util).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(' ');
  const test = tabsOf(page, 'test').getByRole('tab', { name: 'test.ts' });
  await expect(test).toHaveAttribute('aria-selected', 'true');
  await expect(test).toBeFocused();
});

test('stickyPinned keeps the pinned tabs in view while the others scroll, and turns off in a narrow list', async ({
  page,
}) => {
  await page.goto('/stacks.html?pinned=1&sticky=1');
  for (let index = 0; index < 10; index += 1)
    await command(
      page,
      'addTab',
      'docs',
      { type: 'pane', id: `extra${index}` },
      undefined,
      { activate: false }
    );
  const list = tabsOf(page, 'main');
  await expect(list.getByRole('tab')).toHaveCount(15);
  await expect(list).toHaveAttribute('data-sticky-pinned', '');
  const box = async (name: string) => {
    const value = await list.getByRole('tab', { name }).boundingBox();
    if (value === null) throw new Error(`No tab: ${name}`);
    return value;
  };
  const main = await box('main.ts');
  const util = await box('util.ts');
  const before = await box('test.ts');
  const pinnedWidth = await list.evaluate((element) =>
    Number.parseFloat(
      getComputedStyle(element).getPropertyValue('--layouts-pinned-width')
    )
  );
  expect(Math.abs(pinnedWidth - (util.x + util.width - main.x))).toBeLessThan(
    1
  );
  await list.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  expect((await box('test.ts')).x).toBeLessThan(before.x - 50);
  expect(Math.abs((await box('main.ts')).x - main.x)).toBeLessThan(1);
  expect(Math.abs((await box('util.ts')).x - util.x)).toBeLessThan(1);
  // A tab that takes the focus scrolls into view beside the pinned tabs.
  await list.getByRole('tab', { name: 'test.ts' }).focus();
  expect((await box('test.ts')).x).toBeGreaterThan(util.x + util.width - 1);
  // A list with less than 120 px left for the other tabs scrolls them all.
  await page.setViewportSize({ width: 420, height: 900 });
  await expect(list).not.toHaveAttribute('data-sticky-pinned');
  await expect(list.locator('[data-sticky]')).toHaveCount(0);
});

// Add ten tabs after README.md, so that the editors' tab list scrolls.
async function addTenTabs(page: Page): Promise<void> {
  for (let index = 0; index < 10; index += 1)
    await command(
      page,
      'addTab',
      'docs',
      { type: 'pane', id: `extra${index}` },
      undefined,
      { activate: false }
    );
}

// The left edges of main.ts and util.ts, before and after a scroll of the
// editors' tab list to its end.
async function pinnedPlacesAcrossScroll(page: Page) {
  const list = tabsOf(page, 'main');
  const left = async (name: string) =>
    (await list.getByRole('tab', { name }).boundingBox())?.x ?? Number.NaN;
  const before = [await left('main.ts'), await left('util.ts')];
  await list.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  return { before, after: [await left('main.ts'), await left('util.ts')] };
}

test('stickyPinned with minRoom 0 keeps the pinned tabs in view in a narrow list', async ({
  page,
}) => {
  await page.goto('/stacks.html?pinned=1&sticky=room0');
  await addTenTabs(page);
  await page.setViewportSize({ width: 600, height: 900 });
  const list = tabsOf(page, 'main');
  // Less than the default 120 px is left beside the pinned tabs.
  await expect
    .poll(() =>
      list.evaluate(
        (element) =>
          element.clientWidth -
          Number.parseFloat(
            element.style.getPropertyValue('--layouts-pinned-width')
          )
      )
    )
    .toBeLessThan(120);
  await expect(list).toHaveAttribute('data-sticky-pinned', '');
  const { before, after } = await pinnedPlacesAcrossScroll(page);
  expect(Math.abs(after[0] - before[0])).toBeLessThan(1);
  expect(Math.abs(after[1] - before[1])).toBeLessThan(1);
});

test("a sticky pinned tab stays stuck under an app's class that sets position: relative", async ({
  page,
}) => {
  await page.goto('/stacks.html?pinned=1&sticky=1&tabclass=relative');
  await addTenTabs(page);
  const list = tabsOf(page, 'main');
  await expect(list).toHaveAttribute('data-sticky-pinned', '');
  const util = list.getByRole('tab', { name: 'util.ts' });
  await expect(util).toHaveCSS('position', 'sticky');
  const { before, after } = await pinnedPlacesAcrossScroll(page);
  expect(Math.abs(after[0] - before[0])).toBeLessThan(1);
  expect(Math.abs(after[1] - before[1])).toBeLessThan(1);
  // The tab that does not stick keeps the app's position.
  await expect(list.getByRole('tab', { name: 'test.ts' })).toHaveCSS(
    'position',
    'relative'
  );
});

// The marker of a tab drop, and whether it paints above what is under it.
async function markerOf(page: Page) {
  const marker = page.locator('.pierre-layouts-tab-drop');
  await expect(marker).toHaveCount(1);
  // The marker takes no pointer events, so the probe turns them on.
  return marker.evaluate((element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    const x = box.x + box.width / 2;
    element.style.pointerEvents = 'auto';
    const top = document.elementFromPoint(x, box.y + box.height / 2);
    element.style.pointerEvents = '';
    return { x, onTop: top === element };
  });
}

test('in a scrolled list with sticky pinned tabs, the drop marker shows above them, at the boundary under the pointer', async ({
  page,
}) => {
  await page.goto('/stacks.html?pinned=1&sticky=1');
  await addTenTabs(page);
  const list = tabsOf(page, 'main');
  await expect(list).toHaveAttribute('data-sticky-pinned', '');
  await list.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const main = await tabBox(page, 'main', 'main.ts');
  const util = await tabBox(page, 'main', 'util.ts');
  const y = main.y + main.height / 2;
  await dragTab(page, 'main', 'util.ts', { x: main.x + main.width * 0.3, y });
  let marker = await markerOf(page);
  expect(marker.onTop).toBe(true);
  expect(Math.abs(marker.x - main.x)).toBeLessThan(2);
  // Past the pinned run, a pinned tab drops at the end of the run.
  await page.mouse.move(util.x + util.width + 40, y, { steps: 3 });
  marker = await markerOf(page);
  expect(marker.onTop).toBe(true);
  expect(Math.abs(marker.x - (util.x + util.width))).toBeLessThan(2);
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('in a scrolled list, the drop marker shows at the edge of the tab under the pointer', async ({
  page,
}) => {
  await page.goto('/stacks.html?scroll=1');
  await addTenTabs(page);
  const list = tabsOf(page, 'main');
  await list.evaluate((element) => {
    element.scrollLeft = 200;
  });
  const tabs = list.getByRole('tab');
  const from = await tabs.nth(6).boundingBox();
  const to = await tabs.nth(8).boundingBox();
  if (from === null || to === null) throw new Error('No tabs');
  const y = from.y + from.height / 2;
  await page.mouse.move(from.x + from.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width * 0.3, y, { steps: 6 });
  const marker = await markerOf(page);
  expect(marker.onTop).toBe(true);
  expect(Math.abs(marker.x - to.x)).toBeLessThan(2);
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('a tab drag keeps its drop in the tab list while the pointer is in the header band, and shows the pane preview below it', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  const list = await tabsOf(page, 'main').boundingBox();
  const test = await tabBox(page, 'main', 'test.ts');
  if (list === null) throw new Error('No tab list');
  await dragTab(page, 'main', 'util.ts', {
    x: test.x + test.width * 0.7,
    y: list.y + list.height + 4,
  });
  await expect(page.locator('.pierre-layouts-tab-drop')).toHaveCount(1);
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(0);
  await page.mouse.move(test.x + test.width * 0.7, list.y + list.height + 80, {
    steps: 4,
  });
  await expect(page.locator('.pierre-layouts-tab-drop')).toHaveCount(0);
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('a tab drag held near the end of a tab list scrolls it', async ({
  page,
}) => {
  await page.goto('/stacks.html?scroll=1');
  await addTenTabs(page);
  const list = tabsOf(page, 'main');
  const box = await list.boundingBox();
  if (box === null) throw new Error('No tab list');
  const scrollLeft = () => list.evaluate((element) => element.scrollLeft);
  expect(await scrollLeft()).toBe(0);
  await dragTab(page, 'main', 'util.ts', {
    x: box.x + box.width - 6,
    y: box.y + box.height / 2,
  });
  await expect.poll(scrollLeft).toBeGreaterThan(100);
  // Back near the start, it scrolls back.
  await page.mouse.move(box.x + 6, box.y + box.height / 2, { steps: 4 });
  await expect.poll(scrollLeft).toBe(0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('sticky pinned tabs cover the tabs that scroll under them, their marks and the gaps included', async ({
  page,
}) => {
  await page.goto('/stacks.html?pinned=1&sticky=1&tabmark=1&gap=1');
  await addTenTabs(page);
  const list = tabsOf(page, 'main');
  await expect(list).toHaveAttribute('data-sticky-pinned', '');
  const main = await tabBox(page, 'main', 'main.ts');
  const util = await tabBox(page, 'main', 'util.ts');
  const test = await tabBox(page, 'main', 'test.ts');
  // test.ts scrolls under util.ts: its mark is under util.ts.
  await list.evaluate((element, by) => {
    element.scrollLeft = by;
  }, test.x - util.x);
  const hits = await list.evaluate(
    (element, points) =>
      points.map(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return (
          hit
            ?.closest('[data-layouts-tab]')
            ?.getAttribute('data-layouts-tab') ?? 'none'
        );
      }),
    [
      [util.x + 6, util.y + 8],
      [main.x + main.width + 2, main.y + main.height / 2],
    ]
  );
  expect(hits[0]).toBe('util');
  expect(hits[1]).not.toBe('test');
  expect(hits[1]).not.toMatch(/^extra/);
});

test('a stuck selected tab keeps its look, and a stuck tab shows its focus outline', async ({
  page,
}) => {
  // The bottom rows of the selected main.ts (its underline) and its top rows
  // (its focus outline), without and with stickyPinned.
  const rows = async (query: string) => {
    await page.goto(`/stacks.html?pinned=1${query}`);
    const list = tabsOf(page, 'main');
    if (query !== '')
      await expect(list).toHaveAttribute('data-sticky-pinned', '');
    const main = list.getByRole('tab', { name: 'main.ts' });
    const box = await main.boundingBox();
    if (box === null) throw new Error('No tab');
    const clip = (y: number) => ({
      x: box.x + 4,
      y,
      width: box.width - 8,
      height: 2,
    });
    const underline = await page.screenshot({
      clip: clip(box.y + box.height - 2),
    });
    await main.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect(main).toBeFocused();
    const outline = await page.screenshot({ clip: clip(box.y) });
    return {
      underline: underline.toString('base64'),
      outline: outline.toString('base64'),
    };
  };
  const plain = await rows('');
  const sticky = await rows('&sticky=1');
  expect(sticky.underline).toBe(plain.underline);
  expect(sticky.outline).toBe(plain.outline);
});

test("the layout's canPlace refuses a place of a tab drag once for each target, and allows the others", async ({
  page,
}) => {
  await page.goto('/stacks.html?refuse=edges');
  const files = await host(page, 'files').boundingBox();
  if (files === null) throw new Error('No box for files');
  await dragTab(page, 'main', 'util.ts', {
    x: files.x + files.width - 6,
    y: files.y + files.height / 2,
  });
  await page.mouse.move(files.x + files.width - 4, files.y + files.height / 2, {
    steps: 6,
  });
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(0);
  await expect(page.getByRole('status')).not.toHaveText(/^Move /);
  await page.mouse.up();
  await expect(host(page, 'files')).toHaveCount(1);
  expect(await editorsOrder(page)).toEqual([
    'main',
    'util',
    'test',
    'types',
    'docs',
  ]);
  const asked = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __stacks: {
              asked: {
                source: string;
                place: {
                  beside?: string;
                  edge?: string;
                  into?: string;
                  index?: number;
                };
              }[];
            };
          }
        ).__stacks.asked
    );
  // The pointer moves over the edge of Files many times, and the drag asks
  // about that target once.
  const edges = (await asked()).filter(
    ({ place }) => place.beside === 'files' && place.edge === 'right'
  );
  expect(edges).toHaveLength(1);
  expect(edges[0]).toEqual({
    source: 'util',
    place: { beside: 'files', edge: 'right' },
  });
  // A place in another tab list is allowed, at its index among the tabs.
  const output = await tabBox(page, 'terminal', 'Output');
  await dragTab(page, 'main', 'util.ts', {
    x: output.x + output.width - 4,
    y: output.y + output.height / 2,
  });
  await expect(page.locator('.pierre-layouts-tab-drop')).toHaveCount(1);
  await page.mouse.up();
  await expect(tabsOf(page, 'util').getByRole('tab')).toHaveCount(3);
  expect((await asked()).at(-1)).toEqual({
    source: 'util',
    place: { into: 'terminal', index: 2 },
  });
});

test('the move handle of a pinned tab moves it beside another pane, still pinned', async ({
  page,
}) => {
  await page.goto('/stacks.html?pinned=1');
  const handle = host(page, 'main').getByRole('button', {
    name: 'Drag main.ts',
  });
  await expect(handle).not.toHaveAttribute('aria-disabled');
  const from = await handle.boundingBox();
  const files = await host(page, 'files').boundingBox();
  if (from === null || files === null) throw new Error('No box');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(files.x + 10, files.y + files.height / 2, { steps: 6 });
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(1);
  await page.mouse.up();
  await expect
    .poll(() => editorsOrder(page))
    .toEqual(['util', 'test', 'types', 'docs']);
  await expect(
    tabsOf(page, 'main').getByRole('tab', { name: 'main.ts' })
  ).toHaveAttribute('data-pinned', 'true');
});

test.describe('a touch drag of a tab', () => {
  test.use({ hasTouch: true });

  // A finger: it sends touch events with one CDP session, which keeps the
  // touch between its events.
  async function fingerOf(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    return (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      point: { x: number; y: number } = { x: 0, y: 0 }
    ) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [point],
      });
  }

  async function center(page: Page, name: string, hostId = 'main') {
    const value = await tabBox(page, hostId, name);
    return { x: value.x + value.width / 2, y: value.y + value.height / 2 };
  }

  test('a swipe on a tab list scrolls it and moves no tab', async ({
    page,
  }) => {
    await page.goto('/stacks.html?scroll=1');
    for (let index = 0; index < 10; index += 1)
      await command(
        page,
        'addTab',
        'docs',
        { type: 'pane', id: `extra${index}` },
        undefined,
        { activate: false }
      );
    const before = await editorsOrder(page);
    const from = await center(page, 'test.ts');
    const touch = await fingerOf(page);
    await touch('touchStart', from);
    for (let step = 1; step <= 8; step += 1)
      await touch('touchMove', { x: from.x - step * 25, y: from.y });
    await touch('touchEnd');
    await expect
      .poll(() => tabsOf(page, 'main').evaluate((list) => list.scrollLeft))
      .toBeGreaterThan(20);
    await expect(page.locator('.pierre-layouts-tab-drop')).toHaveCount(0);
    expect(await editorsOrder(page)).toEqual(before);
  });

  test('a still press of 250 ms starts the drag, and a quick tap selects the tab', async ({
    page,
  }) => {
    await page.goto('/stacks.html?scroll=1');
    const from = await center(page, 'types.ts');
    const util = await tabBox(page, 'main', 'util.ts');
    const touch = await fingerOf(page);
    await touch('touchStart', from);
    await page.waitForTimeout(350);
    for (let step = 1; step <= 6; step += 1)
      await touch('touchMove', {
        x: from.x + ((util.x + 4 - from.x) * step) / 6,
        y: from.y,
      });
    await expect(page.locator('.pierre-layouts-tab-drop')).toHaveCount(1);
    await touch('touchEnd');
    await expect
      .poll(() => editorsOrder(page))
      .toEqual(['main', 'types', 'util', 'test', 'docs']);
    // The dropped tab shows: its host holds the tab list now.
    const tab = await center(page, 'test.ts', 'types');
    await touch('touchStart', tab);
    await page.waitForTimeout(50);
    await touch('touchEnd');
    await expect(
      tabsOf(page, 'test').getByRole('tab', { name: 'test.ts' })
    ).toHaveAttribute('aria-selected', 'true');
  });
});

test('a copy of the tab follows the pointer during a drag, and leaves at the drop and at Escape', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  const image = page.locator('.pierre-layouts-drag-image');
  const source = await tabBox(page, 'main', 'util.ts');
  const target = await tabBox(page, 'main', 'types.ts');
  await dragTab(page, 'main', 'util.ts', {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  });
  await expect(image).toHaveCount(1);
  await expect(image).toHaveAttribute('aria-hidden', 'true');
  await expect(image).toHaveText('util.ts');
  await expect(image.locator('[id]')).toHaveCount(0);
  await expect(
    tabsOf(page, 'main').getByRole('tab', { name: 'util.ts' })
  ).toHaveAttribute('data-dragging', 'true');
  await expect(page.locator('.pierre-layouts-tab-drop')).toHaveCount(1);
  // The copy has the size of the tab, below and after the pointer, so the
  // drop marker at the pointer stays in view.
  const first = await image.boundingBox();
  expect(
    Math.abs((first?.x ?? 0) - (target.x + target.width / 2 + 12))
  ).toBeLessThan(2);
  expect(Math.abs((first?.width ?? 0) - source.width)).toBeLessThan(2);
  await page.mouse.move(
    target.x + target.width / 2 + 30,
    target.y + target.height / 2 + 3,
    { steps: 3 }
  );
  const moved = await image.boundingBox();
  expect(Math.round((moved?.x ?? 0) - (first?.x ?? 0))).toBe(30);
  expect(Math.round((moved?.y ?? 0) - (first?.y ?? 0))).toBe(3);
  await page.mouse.up();
  await expect(image).toHaveCount(0);
  await dragTab(page, 'util', 'test.ts', {
    x: target.x + 10,
    y: target.y + target.height / 2,
  });
  await expect(image).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(image).toHaveCount(0);
  await page.mouse.up();
});

test("tabDrag's preview puts the app's element beside the pointer", async ({
  page,
}) => {
  await page.goto('/stacks.html?preview=1');
  const target = await tabBox(page, 'main', 'types.ts');
  await dragTab(page, 'main', 'util.ts', {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  });
  const image = page.locator('.pierre-layouts-drag-image');
  await expect(image).toHaveText('Moving util.ts');
  await expect(image.locator('.stacks-preview')).toHaveCount(1);
  await page.mouse.up();
  await expect(image).toHaveCount(0);
});

test('only a tab list with stickyPinned adds the sheet of sticky pinned tabs', async ({
  page,
}) => {
  const sheet = page.locator(
    'head style[data-href="pierre-layouts-sticky-pinned"]'
  );
  await page.goto('/stacks.html?pinned=1');
  await expect(
    page.locator('head style[data-href="pierre-layouts-tabs"]')
  ).toHaveCount(1);
  await expect(sheet).toHaveCount(0);
  await page.goto('/stacks.html?pinned=1&sticky=1');
  await expect(sheet).toHaveCount(1);
});

test("tabDrag's preview false shows no image, and a move that keeps its target changes nothing in the page", async ({
  page,
}) => {
  // The count of DOM changes while the pointer moves between the same two
  // tabs: each change of the page needs a new frame.
  const changesOf = async (query: string) => {
    await page.goto(`/stacks.html${query}`);
    const target = await tabBox(page, 'main', 'types.ts');
    const y = target.y + target.height / 2;
    await dragTab(page, 'main', 'util.ts', { x: target.x + 6, y });
    await expect(page.locator('.pierre-layouts-tab-drop')).toHaveCount(1);
    await page.evaluate(() => {
      const target = window as unknown as { __changes: number };
      target.__changes = 0;
      new MutationObserver((records) => {
        target.__changes += records.length;
      }).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    });
    for (let step = 1; step <= 6; step += 1)
      await page.mouse.move(target.x + 6 + step, y + (step % 2));
    const changes = await page.evaluate(
      () => (window as unknown as { __changes: number }).__changes
    );
    const images = await page.locator('.pierre-layouts-drag-image').count();
    await page.mouse.up();
    return { changes, images };
  };
  expect(await changesOf('?preview=none')).toEqual({ changes: 0, images: 0 });
  const withImage = await changesOf('');
  expect(withImage.images).toBe(1);
  expect(withImage.changes).toBeGreaterThan(0);
});

test('a merge of a stack into another speaks once, with each tab', async ({
  page,
}) => {
  await page.goto('/stacks.html');
  await page.evaluate(() =>
    (
      window as unknown as {
        __stacks: { layout: { mergeStack(id: string, target?: string): void } };
      }
    ).__stacks.layout.mergeStack('terminal')
  );
  await expect(page.locator('.pierre-layouts > [role="status"]')).toHaveText(
    'Terminal, Output moved into the group of Files'
  );
  await expect(page.locator('[data-layouts-pane="files"]')).toHaveAttribute(
    'role',
    'tabpanel'
  );
});

test('with stacks(), the tab sheet is in the page before the first stack, so the first stack lays out no text again', async ({
  page,
  browser,
}) => {
  // The main demo has stacks() and no stack at first.
  await page.goto('/');
  await expect(page.locator('[data-layouts-pane]')).toHaveCount(7);
  await expect(page.getByRole('tablist')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      [...document.head.querySelectorAll('style')].map(
        (style) => style.dataset.href
      )
    )
  ).toContain('pierre-layouts-tabs');
  // A sheet that comes later goes before the app's stylesheets, and Chromium
  // then updates the fonts of the whole document: each text lays out again,
  // and a hidden pane lays out all its content when it shows.
  await browser.startTracing(page, {
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'blink',
    ],
  });
  await page.getByRole('button', { name: 'Add tab', exact: true }).click();
  await expect(page.getByRole('tablist').first()).toBeVisible();
  await page.waitForTimeout(200);
  const events = (
    JSON.parse((await browser.stopTracing()).toString()) as {
      traceEvents: { name: string }[];
    }
  ).traceEvents;
  expect(
    events.filter(
      (event) =>
        event.name === 'StyleEngine::InvalidateStyleAndLayoutForFontUpdates'
    )
  ).toEqual([]);
});
