import { expect, type Page, test } from '@playwright/test';

// `zoom()`, `Layout.ZoomButton`, `focusRing()`, `requires`, the slots by
// name, and the caches of the view (demo/zoom.tsx).

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

// Call a command of the layout object of the page.
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

const box = async (page: Page, selector: string) => {
  const value = await page.locator(selector).first().boundingBox();
  if (value === null) throw new Error(`No box: ${selector}`);
  return value;
};

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

test('the zoom button zooms a pane over the layout and restores it', async ({
  page,
}) => {
  await page.goto('/zoom.html');
  const button = page.getByRole('button', { name: 'Zoom editor' });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('separator')).toHaveCount(3);
  await button.click();
  const restore = page.getByRole('button', { name: 'Restore editor' });
  await expect(restore).toHaveAttribute('aria-pressed', 'true');
  await expect(restore).toHaveAttribute('data-zoomed', 'true');
  const editor = host(page, 'editor');
  await expect(editor).toHaveAttribute('data-zoomed', 'true');
  await expect(editor).toHaveAttribute(
    'data-layout-edges',
    'top right bottom left'
  );
  await expect(editor.locator('.pierre-layout-header')).toHaveAttribute(
    'data-zoomed',
    'true'
  );
  expect(await box(page, '[data-layout-pane="editor"]')).toEqual(
    await box(page, '.pierre-layout')
  );
  // The covered panes skip their rendering and leave the tab order.
  for (const id of ['notes', 'files', 'terminal']) {
    await expect(host(page, id)).toHaveAttribute('data-hidden', 'true');
    expect(
      await host(page, id).evaluate((element: HTMLElement) => element.inert)
    ).toBe(true);
  }
  await expect(page.getByRole('separator')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('editor zoomed');
  // The focus ring surrounds the layout.
  expect(await box(page, '.pierre-layout-focus')).toEqual(
    await box(page, '.pierre-layout')
  );
  await restore.click();
  await expect(editor).not.toHaveAttribute('data-zoomed');
  await expect(page.getByRole('separator')).toHaveCount(3);
  for (const id of ['notes', 'files', 'terminal'])
    await expect(host(page, id)).not.toHaveAttribute('data-hidden');
  expect(await visibility(page)).toEqual({
    notes: [true, false],
    files: [true, false],
    terminal: [true, false],
  });
});

test('Escape restores the zoom, and the focus moves into the zoomed pane', async ({
  page,
}) => {
  await page.goto('/zoom.html');
  await page.getByLabel('Note in files').focus();
  await command(page, 'setZoom', 'editor');
  await expect(host(page, 'editor')).toBeFocused();
  await expect(host(page, 'files')).toHaveAttribute('data-hidden', 'true');
  await page.keyboard.press('Escape');
  await expect(host(page, 'editor')).not.toHaveAttribute('data-zoomed');
  await expect(host(page, 'files')).not.toHaveAttribute('data-hidden');
});

test('a collapsed pane under a zoom gets no visibility event at the zoom, after it, or at the restore', async ({
  page,
}) => {
  await page.goto('/zoom.html');
  await page.getByRole('button', { name: 'Collapse terminal' }).click();
  await expect(host(page, 'terminal')).toHaveAttribute(
    'data-collapsed',
    'true'
  );
  expect((await visibility(page)).terminal).toEqual([true]);
  await page.getByRole('button', { name: 'Zoom editor' }).click();
  await expect(host(page, 'terminal')).toHaveAttribute('data-hidden', 'true');
  // The hide of the covered panes waits for the animations of the zoom.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve))
  );
  expect((await visibility(page)).terminal).toEqual([true]);
  await page.getByRole('button', { name: 'Restore editor' }).click();
  await expect(host(page, 'terminal')).not.toHaveAttribute('data-hidden');
  await expect(host(page, 'terminal')).toHaveAttribute(
    'data-collapsed',
    'true'
  );
  expect((await visibility(page)).terminal).toEqual([true]);
});

test('a zoomed stack follows its shown tab, and a split ends the zoom', async ({
  page,
}) => {
  await page.goto('/zoom.html');
  await command(page, 'setZoom', 'notes');
  await expect(host(page, 'notes')).toHaveAttribute('data-zoomed', 'true');
  await expect(page.getByRole('status')).toHaveText('notes zoomed');
  // The zoom follows the tab with no zoom operation, so nothing new is
  // announced: the focus moves to the tab.
  await command(page, 'activate', 'logs');
  await expect(host(page, 'logs')).toHaveAttribute('data-zoomed', 'true');
  await expect(page.getByRole('status')).toHaveText('notes zoomed');
  await command(page, 'split', 'files', { type: 'pane', id: 'new' }, 'right');
  await expect(host(page, 'logs')).not.toHaveAttribute('data-zoomed');
  await expect(page.getByRole('separator')).toHaveCount(4);
});

// The demo renders under StrictMode, which detaches the ref of a new host and
// attaches it again after the effects of its commit.
test('a pane that a zoomed layout gets is covered like the other panes', async ({
  page,
}) => {
  await page.goto('/zoom.html');
  await command(page, 'setZoom', 'editor');
  await expect(host(page, 'files')).toHaveAttribute('data-hidden', 'true');
  // A new tree keeps the zoom; a local edit that shows a new pane ends it.
  await page.evaluate(() => {
    const { layout } = (
      window as unknown as {
        __zoom: {
          layout: {
            getSnapshot(): { root: { children: unknown[] } };
            setRoot(root: unknown): void;
          };
        };
      }
    ).__zoom;
    const { root } = layout.getSnapshot();
    const column = root.children[2] as { children: unknown[] };
    layout.setRoot({
      ...root,
      children: [
        root.children[0],
        root.children[1],
        {
          ...column,
          sizes: [1, 1, 1],
          children: [...column.children, { type: 'pane', id: 'late' }],
        },
      ],
    });
  });
  await expect(host(page, 'late')).toHaveCount(1);
  await expect(host(page, 'editor')).toHaveAttribute('data-zoomed', 'true');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve))
  );
  for (const id of ['files', 'late']) {
    await expect(host(page, id)).toHaveAttribute('aria-hidden', 'true');
    await expect(host(page, id)).toHaveAttribute('data-hidden', 'true');
    await expect(host(page, id)).toHaveAttribute('tabindex', '-1');
  }
  await command(page, 'setZoom', null);
  await expect(host(page, 'late')).not.toHaveAttribute('data-hidden');
  await expect(host(page, 'late')).not.toHaveAttribute('aria-hidden');
});

test('the focus ring follows the focused pane', async ({ page }) => {
  await page.goto('/zoom.html');
  await page.getByLabel('Note in files').click();
  expect(await box(page, '.pierre-layout-focus')).toEqual(
    await box(page, '[data-layout-pane="files"]')
  );
});

test('the full set without zoom() has no zoom, and its zoom buttons warn', async ({
  page,
}) => {
  const warnings = warningsOf(page);
  await page.goto('/zoom.html?features=nozoom');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(5);
  expect(
    warnings.filter((text) => text.includes('Layout.ZoomButton needs zoom()'))
  ).toHaveLength(1);
  const sheets = await page.evaluate(() =>
    [
      ...document.head.querySelectorAll<HTMLStyleElement>(
        'style[data-precedence="pierre-layouts"]'
      ),
    ].map((style) => style.dataset.href)
  );
  expect(sheets).not.toContain('pierre-layouts-zoom');
  expect(
    await page.evaluate(
      () =>
        typeof (
          window as unknown as { __zoom: { layout: { setZoom?: unknown } } }
        ).__zoom.layout.setZoom
    )
  ).toBe('undefined');
  await page.getByRole('button', { name: 'Zoom editor' }).click();
  await expect(page.locator('[data-zoomed]')).toHaveCount(0);
  await expect(page.getByRole('separator')).toHaveCount(3);
});

test('the order of the feature list does not change the zoom', async ({
  page,
}) => {
  await page.goto('/zoom.html?features=reversed');
  await page.getByRole('button', { name: 'Zoom editor' }).click();
  expect(await box(page, '[data-layout-pane="editor"]')).toEqual(
    await box(page, '.pierre-layout')
  );
});

test('a feature without a feature that it requires warns in development', async ({
  page,
}) => {
  const warnings = warningsOf(page);
  await page.goto('/zoom.html?requires=missing');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(5);
  expect(
    warnings.filter((text) =>
      text.includes('the feature needs-drag needs the feature pane-drag')
    )
  ).toHaveLength(1);
});

test('two features that give the style of a host warn in development', async ({
  page,
}) => {
  const warnings = warningsOf(page);
  await page.goto('/zoom.html?slots=conflict');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(5);
  await expect
    .poll(
      () =>
        warnings.filter((text) =>
          text.includes('two features fill the style of a pane host')
        ).length
    )
    .toBe(1);
});

test('the caches of the view keep only the panes of the tree', async ({
  page,
}) => {
  await page.goto('/zoom.html');
  const panes = ['editor', 'files', 'logs', 'notes', 'terminal'];
  const cached = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          __zoom: {
            cachedPanes(): { contexts: string[]; visibility: string[] };
          };
        }
      ).__zoom.cachedPanes()
    );
  expect(await cached()).toEqual({ contexts: panes, visibility: panes });
  const original = await page.evaluate(
    () =>
      (
        window as unknown as { __zoom: { layout: { getSnapshot(): unknown } } }
      ).__zoom.layout.getSnapshot() as { root: unknown }
  );
  // Ten rounds add 100 panes with new IDs, render them, and remove them.
  for (let round = 0; round < 10; round++) {
    await page.evaluate(
      ([round, root]) => {
        const ids = Array.from(
          { length: 100 },
          (_, index) => `round-${round}-${index}`
        );
        (
          window as unknown as {
            __zoom: { layout: { setRoot(root: unknown): void } };
          }
        ).__zoom.layout.setRoot({
          type: 'split',
          id: 'more',
          direction: 'vertical',
          sizes: [1, 1],
          children: [
            root,
            {
              type: 'split',
              id: 'extra',
              direction: 'horizontal',
              sizes: ids.map(() => 1),
              children: ids.map((id) => ({ type: 'pane', id })),
            },
          ],
        });
      },
      [round, original.root] as const
    );
    await expect(page.locator('[data-layout-pane]')).toHaveCount(105);
    await command(page, 'setRoot', original.root);
    await expect(page.locator('[data-layout-pane]')).toHaveCount(5);
  }
  expect(await cached()).toEqual({ contexts: panes, visibility: panes });
});
