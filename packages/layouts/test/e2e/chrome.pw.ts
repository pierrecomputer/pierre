import { expect, type Page, test } from '@playwright/test';

// The pane chrome parts and `Layout.usePane` (demo/chrome.tsx): `Header`,
// `Title`, `CollapseButton`, `CloseButton`, and `Content`, the visibility of
// the panes, `messages`, and the props callbacks of `Root`.

interface ChromePage {
  renders: Record<string, number>;
  statusRenders: Record<string, number>;
  visibility: Record<string, boolean[]>;
  appCloseClicks: number;
  separators: {
    id: string;
    splitId: string;
    index: number;
    direction: string;
    before: { id: string }[];
    after: { id: string }[];
  }[];
}

const read = async (page: Page): Promise<ChromePage> =>
  JSON.parse(
    await page.evaluate(() =>
      JSON.stringify((window as unknown as { __chrome: unknown }).__chrome)
    )
  ) as ChromePage;

// Call a command of the layout object of the page.
const command = (page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([name, args]) => {
      const layout = (
        window as unknown as {
          __chrome: { layout: Record<string, (...args: unknown[]) => void> };
        }
      ).__chrome.layout;
      layout[name](...args);
    },
    [name, args] as const
  );

const host = (page: Page, id: string) =>
  page.locator(`[data-layouts-pane="${id}"]`);

// The console warnings of the page, from its load on.
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

test('the parts render the chrome, and only their sheets are in the head', async ({
  page,
}) => {
  await page.goto('/chrome.html');
  await expect(page.locator('.pierre-layouts-header')).toHaveCount(3);
  await expect(
    host(page, 'editor').locator('.pierre-layouts-title')
  ).toHaveText('editor');
  const sheets = await page.evaluate(() =>
    [
      ...document.head.querySelectorAll<HTMLStyleElement>(
        'style[data-precedence="pierre-layouts"]'
      ),
    ].map((style) => style.dataset.href)
  );
  // Each sheet is in the head once, also with a header and a content area in
  // each pane.
  expect(new Set(sheets)).toEqual(
    new Set([
      'pierre-layouts-split',
      'pierre-layouts-headers',
      'pierre-layouts-content',
    ])
  );
  expect(sheets).toHaveLength(3);
});

test('a collapse keeps the header and hides the content, with no render of the content', async ({
  page,
}) => {
  await page.goto('/chrome.html');
  const before = await read(page);
  const button = page.getByRole('button', { name: 'Collapse terminal' });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveAttribute('data-collapsed', 'true');
  const terminal = host(page, 'terminal');
  await expect(terminal).toHaveAttribute('data-collapsed', 'true');
  expect(
    await terminal.evaluate((element) => element.getBoundingClientRect().height)
  ).toBe(36);
  await expect(terminal.locator('.pierre-layouts-header')).toBeVisible();
  const content = terminal.locator('.pierre-layouts-content');
  await expect(content).toHaveAttribute('data-collapsed', 'true');
  await expect(content).toHaveCSS('content-visibility', 'hidden');
  expect(await content.evaluate((element: HTMLElement) => element.inert)).toBe(
    true
  );
  // The host itself shows and stays in the tab order: only a collapse to 0
  // pixels hides it.
  expect(await terminal.evaluate((element: HTMLElement) => element.inert)).toBe(
    false
  );
  await expect(terminal).not.toHaveAttribute('data-hidden');
  const after = await read(page);
  expect(after.renders).toEqual(before.renders);
  expect(after.visibility).toEqual({ terminal: [true] });
  await button.click();
  await expect(content).not.toHaveAttribute('data-collapsed');
  await expect(terminal).not.toHaveAttribute('data-collapsed');
  expect(await content.evaluate((element: HTMLElement) => element.inert)).toBe(
    false
  );
  expect((await read(page)).visibility).toEqual({ terminal: [true, false] });
});

test('a pane that does not render gets no event when a second reason starts or ends', async ({
  page,
}) => {
  await page.goto('/chrome.html');
  await page.getByRole('button', { name: 'Collapse terminal' }).click();
  await command(page, 'setHidden', 'terminal', true);
  const terminal = host(page, 'terminal');
  await expect(terminal).toHaveAttribute('data-hidden', 'true');
  expect(await terminal.evaluate((element: HTMLElement) => element.inert)).toBe(
    true
  );
  await expect(terminal.locator('.app-status')).toHaveAttribute(
    'data-status',
    'collapsed not-shown'
  );
  await command(page, 'setHidden', 'terminal', false);
  await expect(terminal).not.toHaveAttribute('data-hidden');
  // The content still does not render: the pane is still collapsed.
  expect((await read(page)).visibility).toEqual({ terminal: [true] });
  await page.getByRole('button', { name: 'Collapse terminal' }).click();
  await expect(terminal).not.toHaveAttribute('data-collapsed');
  expect((await read(page)).visibility).toEqual({ terminal: [true, false] });
});

test('a pane that starts hidden is hidden in the first render, and shows with an event', async ({
  page,
}) => {
  await page.goto('/chrome.html?start=hidden');
  const notes = host(page, 'notes');
  await expect(notes).toHaveAttribute('data-hidden', 'true');
  expect(await notes.evaluate((element: HTMLElement) => element.inert)).toBe(
    true
  );
  await expect(notes.locator('.app-status')).toHaveAttribute(
    'data-status',
    'not-shown'
  );
  await command(page, 'setHidden', 'notes', false);
  await expect(notes).not.toHaveAttribute('data-hidden');
  expect(await notes.evaluate((element: HTMLElement) => element.inert)).toBe(
    false
  );
  await expect(notes.locator('.app-status')).not.toHaveAttribute(
    'data-status',
    /not-shown/
  );
  expect((await read(page)).visibility).toEqual({ notes: [false] });
});

test('the content area scrolls', async ({ page }) => {
  await page.goto('/chrome.html');
  const content = host(page, 'editor').locator('.pierre-layouts-content');
  await expect(content).toHaveCSS('overflow-y', 'auto');
  expect(
    await content.evaluate((element) => {
      element.scrollTop = 100;
      return element.scrollTop;
    })
  ).toBe(100);
});

test('the close buttons close panes, and the last pane cannot close', async ({
  page,
}) => {
  await page.goto('/chrome.html');
  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(host(page, 'editor')).toHaveCount(0);
  // The app's handler runs with the part's own.
  await page.getByRole('button', { name: 'Close notes' }).click();
  await expect(host(page, 'notes')).toHaveCount(0);
  expect((await read(page)).appCloseClicks).toBe(1);
  const last = page.getByRole('button', { name: 'Close terminal' });
  await expect(last).toBeDisabled();
  await expect(last).toHaveAttribute('data-disabled', 'true');
  // The close moves the focus to the pane that has it next.
  await expect(host(page, 'terminal')).toBeFocused();
});

test('a render prop keeps the app element and its classes', async ({
  page,
}) => {
  await page.goto('/chrome.html');
  const header = host(page, 'notes').locator('header');
  await expect(header).toHaveClass('pierre-layouts-header app-header');
  const close = page.getByRole('button', { name: 'Close notes' });
  await expect(close).toHaveClass('app-close');
  await expect(close).toHaveAttribute('data-app-disabled', 'false');
});

test('the header shows the focus of its pane', async ({ page }) => {
  await page.goto('/chrome.html');
  const header = host(page, 'notes').locator('.pierre-layouts-header');
  await expect(header).not.toHaveAttribute('data-focused');
  await host(page, 'notes').locator('.pierre-layouts-content').click();
  await expect(header).toHaveAttribute('data-focused', 'true');
  await expect(
    host(page, 'editor').locator('.pierre-layouts-header')
  ).not.toHaveAttribute('data-focused');
});

test('a focus change renders no pane content, and only the components that read the focus of the two panes', async ({
  page,
}) => {
  const warnings = warningsOf(page);
  await page.goto('/chrome.html');
  await expect(host(page, 'editor').locator('.app-status')).toHaveAttribute(
    'data-status',
    'focused'
  );
  const before = await read(page);
  await host(page, 'notes').locator('.pierre-layouts-content').click();
  await expect(host(page, 'notes').locator('.app-status')).toHaveAttribute(
    'data-status',
    'focused'
  );
  const after = await read(page);
  expect(after.renders).toEqual(before.renders);
  expect(after.statusRenders).toEqual({
    editor: before.statusRenders.editor + 1,
    terminal: before.statusRenders.terminal,
    notes: before.statusRenders.notes + 1,
  });
  expect(warnings.filter((text) => text.includes('renderPane'))).toEqual([]);
});

test('a change in one pane renders only the components of that pane that read it', async ({
  page,
}) => {
  await page.goto('/chrome.html');
  const before = await read(page);
  await command(page, 'setCollapsed', 'terminal', true);
  await expect(host(page, 'terminal').locator('.app-status')).toHaveAttribute(
    'data-status',
    'collapsed'
  );
  const after = await read(page);
  expect(after.renders).toEqual(before.renders);
  expect(after.statusRenders).toEqual({
    ...before.statusRenders,
    terminal: before.statusRenders.terminal + 1,
  });
});

test('usePane gives the edges and the tabs of a pane', async ({ page }) => {
  await page.goto('/chrome.html');
  const status = (id: string) => host(page, id).locator('.app-status');
  await expect(status('editor')).toHaveAttribute('data-top', 'true');
  await expect(status('editor')).toHaveAttribute('data-bottom', 'false');
  await expect(status('notes')).toHaveAttribute('data-bottom', 'true');
  await expect(status('notes')).toHaveAttribute('data-tabs', 'notes');
});

test('a new renderPane for the same tree warns once in development', async ({
  page,
}) => {
  const warnings = warningsOf(page);
  await page.goto('/chrome.html?render=unstable');
  await host(page, 'notes').locator('.pierre-layouts-content').click();
  await host(page, 'editor').locator('.pierre-layouts-content').click();
  await expect
    .poll(() => warnings.filter((text) => text.includes('renderPane')).length)
    .toBe(1);
});

test('a close button without edits() warns once in development', async ({
  page,
}) => {
  const warnings = warningsOf(page);
  await page.goto('/chrome.html?features=none');
  await expect(page.locator('.pierre-layouts-header')).toHaveCount(3);
  const closeWarnings = warnings.filter((text) =>
    text.includes('Layout.CloseButton needs edits()')
  );
  expect(closeWarnings).toHaveLength(1);
  await expect(
    page.getByRole('button', { name: 'Close editor' })
  ).toBeDisabled();
});

test('the default strings name panes by their titles', async ({ page }) => {
  await page.goto('/chrome.html');
  await expect(page.getByRole('group', { name: 'Workspace' })).toHaveCount(1);
  const separator = page.getByRole('separator').first();
  await expect(separator).toHaveAttribute('aria-label', 'Resize editor');
  await expect(separator).toHaveAttribute('aria-valuetext', 'editor 33%');
  // The live region has no text of its own.
  await expect(page.getByRole('status')).toHaveText('');
});

test('messages replace each string of the layout', async ({ page }) => {
  await page.goto('/chrome.html?messages=fr');
  await expect(
    page.getByRole('group', { name: 'Espace de travail' })
  ).toHaveCount(1);
  const separator = page.getByRole('separator').first();
  await expect(separator).toHaveAttribute(
    'aria-label',
    'Redimensionner editor'
  );
  await expect(separator).toHaveAttribute('aria-valuetext', 'editor : 33 %');
  await expect(
    page.getByRole('button', { name: 'Replier terminal' })
  ).toHaveCount(1);
  // The close name takes the form of the name from the pane ID.
  await expect(
    page.getByRole('button', { name: "Fermer l'éditeur" })
  ).toHaveCount(1);
});

test('getSeparatorProps gets the public separator, and getPaneProps adds data attributes', async ({
  page,
}) => {
  await page.goto('/chrome.html');
  const { separators } = await read(page);
  const last = separators.slice(-2);
  expect(
    last.map(({ before, after, ...rest }) => ({
      ...rest,
      before: before.map(({ id }) => id),
      after: after.map(({ id }) => id),
    }))
  ).toEqual([
    {
      id: expect.any(String),
      splitId: 'column',
      index: 1,
      direction: 'vertical',
      before: ['editor'],
      after: ['terminal'],
    },
    {
      id: expect.any(String),
      splitId: 'column',
      index: 2,
      direction: 'vertical',
      before: ['terminal'],
      after: ['notes'],
    },
  ]);
  expect(new Set(Object.keys(last[0]))).toEqual(
    new Set(['id', 'splitId', 'index', 'direction', 'before', 'after'])
  );
  await expect(host(page, 'editor')).toHaveAttribute('data-app-pane', 'editor');
  await expect(host(page, 'editor')).toHaveAttribute('tabindex', '0');
});

// Hide a pane with a remote change, as a server or an agent does.
const remoteHide = (page: Page, id: string) =>
  page.evaluate(
    (pane) =>
      (
        window as unknown as {
          __chrome: { remote(operations: unknown[]): void };
        }
      ).__chrome.remote([{ type: 'hide', pane, hidden: true }]),
    id
  );

test('a remote change leaves the live region silent, and messages.remote makes it speak', async ({
  page,
}) => {
  await page.goto('/chrome.html');
  await remoteHide(page, 'notes');
  await expect(host(page, 'notes')).toHaveAttribute('data-hidden', 'true');
  await expect(page.getByRole('status')).toHaveText('');
  await page.goto('/chrome.html?messages=remote');
  await remoteHide(page, 'notes');
  await expect(page.getByRole('status')).toHaveText('Agent: notes hidden');
  // A local change speaks as before.
  await page.getByRole('button', { name: 'Collapse terminal' }).click();
  await expect(page.getByRole('status')).toHaveText('terminal collapsed');
});
