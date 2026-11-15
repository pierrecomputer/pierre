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
  await expect(tabs.getByRole('tab')).toHaveCount(3);
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
    tabsOf(page, 'test').getByRole('tab', { name: 'test.ts' })
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
  await expect(tabsOf(page, 'util').getByRole('tab')).toHaveCount(2);
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
  await expect.poll(names).toEqual(['util.ts', 'main.ts', 'test.ts']);
  await expect(
    tabsOf(page, 'main').getByRole('tab', { name: 'main.ts' })
  ).toBeFocused();
  await page.keyboard.press('Control+Shift+PageUp');
  await expect.poll(names).toEqual(['main.ts', 'util.ts', 'test.ts']);
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
  await expect(tabsOf(page, 'main').getByRole('tab')).toHaveCount(2);
  await expect(
    tabsOf(page, 'main').getByRole('tab', { name: 'util.ts' })
  ).toHaveCount(0);
});

test('a tab list without stacks(), and stacks() without a tab list in a pane, warn', async ({
  page,
}) => {
  const warnings = warningsOf(page);
  await page.goto('/stacks.html?features=nostacks');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(6);
  expect(
    warnings.filter((text) => text.includes('Layout.TabList needs stacks()'))
  ).toHaveLength(1);
  await page.goto('/stacks.html?tablist=none');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(6);
  await expect
    .poll(
      () =>
        warnings.filter((text) =>
          text.includes('Render Layout.TabList in the header of each pane')
        ).length
    )
    .toBe(1);
});
