import { expect, type Page, test } from '@playwright/test';

// The app demo has two stacks: the agent chat with a review tab, and the
// terminal with a dev server tab.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(7);
});

const host = (page: Page, id: string) =>
  page.locator(`[data-layout-pane="${id}"]`);

/** The tab list in the header of the host that shows a pane of a stack. */
const tabsOf = (page: Page, id: string) => host(page, id).getByRole('tablist');

test('the tabs of a stack follow the APG tabs pattern', async ({ page }) => {
  const tabs = tabsOf(page, 'terminal');
  // The close mark of a tab is a pointer shortcut, out of the tab's name.
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(tabs.getByRole('tab').nth(0)).toHaveAccessibleName('Terminal');
  await expect(tabs.getByRole('tab').nth(1)).toHaveAccessibleName('Dev server');
  const terminal = tabs.getByRole('tab', { name: 'Terminal' });
  await expect(terminal).toHaveAttribute('aria-selected', 'true');
  await expect(terminal).toHaveAttribute('tabindex', '0');
  await expect(tabs.getByRole('tab', { name: 'Dev server' })).toHaveAttribute(
    'tabindex',
    '-1'
  );
  // The host of the active tab is its tab panel, named by the tab.
  await expect(host(page, 'terminal')).toHaveAttribute('role', 'tabpanel');
  await expect(host(page, 'terminal')).toHaveAccessibleName('Terminal');
  await expect(terminal).toHaveAttribute(
    'aria-controls',
    (await host(page, 'terminal').getAttribute('id')) ?? ''
  );

  // An arrow key moves the focus to the next tab, and that tab shows.
  await terminal.focus();
  await page.keyboard.press('ArrowRight');
  const server = tabsOf(page, 'terminal-server').getByRole('tab', {
    name: 'Dev server',
  });
  await expect(server).toBeFocused();
  await expect(server).toHaveAttribute('aria-selected', 'true');
  await expect(host(page, 'terminal')).toHaveAttribute(
    'data-pane-hidden',
    'true'
  );
  await expect(host(page, 'terminal')).toHaveAttribute('inert', '');
  await expect(host(page, 'terminal-server')).toHaveAttribute(
    'data-pane-hidden',
    'false'
  );
  // The arrows wrap; Home and End go to the first and the last tab.
  await page.keyboard.press('ArrowRight');
  await expect(
    tabsOf(page, 'terminal').getByRole('tab', { name: 'Terminal' })
  ).toBeFocused();
  await page.keyboard.press('End');
  await expect(server).toBeFocused();
  await page.keyboard.press('Home');
  await expect(
    tabsOf(page, 'terminal').getByRole('tab', { name: 'Terminal' })
  ).toBeFocused();
  // Tab leaves the tab list for the controls of the header.
  await page.keyboard.press('Tab');
  await expect(
    host(page, 'terminal').getByRole('button', { name: 'Collapse Terminal' })
  ).toBeFocused();
});

test('a change of tab keeps content state and moves no other pane', async ({
  page,
}) => {
  // With animations on, so that the test sees whether one starts.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await host(page, 'terminal')
    .locator('.agent-terminal')
    .evaluate((element) => element.setAttribute('data-kept', 'yes'));
  const terminal = await host(page, 'terminal').boundingBox();
  const editor = await host(page, 'editor').boundingBox();
  const events: boolean[] = [];
  await page.exposeFunction('recordVisibility', (hidden: boolean) =>
    events.push(hidden)
  );
  await host(page, 'terminal').evaluate((element) =>
    element.addEventListener('pierre-layout-visibility', (event) =>
      (
        window as unknown as { recordVisibility(hidden: boolean): void }
      ).recordVisibility(
        (event as CustomEvent<{ hidden: boolean }>).detail.hidden
      )
    )
  );

  await tabsOf(page, 'terminal')
    .getByRole('tab', { name: 'Dev server' })
    .click();
  await expect(host(page, 'terminal-server')).toHaveAttribute(
    'data-pane-hidden',
    'false'
  );
  // Each pane of the stack has the box of the stack.
  expect(await host(page, 'terminal-server').boundingBox()).toEqual(terminal);
  expect(await host(page, 'editor').boundingBox()).toEqual(editor);
  // The change of tab starts no FLIP animation.
  expect(
    await page.evaluate(
      () =>
        document
          .querySelector('.pierre-layout')
          ?.getAnimations({ subtree: true })
          .filter((animation) => animation.id === 'pierre-layout-flip').length
    )
  ).toBe(0);

  await tabsOf(page, 'terminal-server')
    .getByRole('tab', { name: 'Terminal' })
    .click();
  await expect(
    host(page, 'terminal').locator('.agent-terminal')
  ).toHaveAttribute('data-kept', 'yes');
  await expect.poll(() => events).toEqual([true, false]);
});

test('a tab closes from its close mark or with Delete, and new tabs show', async ({
  page,
}) => {
  // The app hides a tab that closes, so it can show again.
  await tabsOf(page, 'terminal')
    .getByRole('tab', { name: 'Dev server' })
    .locator('.pierre-layout-tab-close')
    .click();
  await expect(host(page, 'terminal-server')).toHaveAttribute(
    'data-pane-hidden',
    'true'
  );
  // The hidden tab leaves the tab list.
  await expect(tabsOf(page, 'terminal').getByRole('tab')).toHaveCount(1);

  await page.getByRole('button', { name: 'New terminal' }).click();
  const added = tabsOf(page, 'terminal-1').getByRole('tab', {
    name: 'Terminal 2',
  });
  await expect(added).toHaveAttribute('aria-selected', 'true');
  await expect(host(page, 'terminal')).toHaveAttribute(
    'data-pane-hidden',
    'true'
  );
  await added.focus();
  await page.keyboard.press('Delete');
  await expect(host(page, 'terminal-1')).toHaveAttribute(
    'data-pane-hidden',
    'true'
  );
  await expect(host(page, 'terminal')).toHaveAttribute(
    'data-pane-hidden',
    'false'
  );
  // The focus goes to the tab that shows next.
  await expect(
    tabsOf(page, 'terminal').getByRole('tab', { name: 'Terminal' })
  ).toBeFocused();
});

test('a zoomed stack stays zoomed when its tab changes', async ({ page }) => {
  await page
    .getByRole('button', { name: 'Zoom Terminal', exact: true })
    .click();
  await expect(host(page, 'terminal')).toHaveAttribute('data-zoomed', 'true');
  await expect(host(page, 'editor')).toHaveAttribute('data-hidden', 'true');

  await tabsOf(page, 'terminal')
    .getByRole('tab', { name: 'Dev server' })
    .click();
  await expect(host(page, 'terminal-server')).toHaveAttribute(
    'data-zoomed',
    'true'
  );
  await expect(
    tabsOf(page, 'terminal-server').getByRole('tab', { name: 'Dev server' })
  ).toBeFocused();
  // The other panes stay covered: they did not show again.
  await expect(host(page, 'editor')).toHaveAttribute('data-hidden', 'true');
  await expect(host(page, 'terminal-server')).not.toHaveAttribute(
    'data-hidden',
    'true'
  );
  await page.keyboard.press('Escape');
  await expect(host(page, 'terminal-server')).toHaveAttribute(
    'data-zoomed',
    'false'
  );
});

test('a tab that does not show is not a compositor layer', async ({ page }) => {
  const layered = (id: string) =>
    host(page, id).evaluate(
      (element) =>
        !(element.computedStyleMap().get('transform') as CSSTransformValue).is2D
    );
  await page.getByLabel('Pane layers').selectOption('on');
  expect(await layered('terminal')).toBe(true);
  expect(await layered('terminal-server')).toBe(false);
  await tabsOf(page, 'terminal')
    .getByRole('tab', { name: 'Dev server' })
    .click();
  expect(await layered('terminal')).toBe(false);
  expect(await layered('terminal-server')).toBe(true);
});
