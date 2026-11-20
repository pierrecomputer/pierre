import { expect, type Page, test } from '@playwright/test';

// The app demo has two sidebars with sizes in pixels: the sessions (240 px)
// and the files (220 px, at most 360 px).
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(7);
});

const width = async (page: Page, id: string): Promise<number> =>
  (await page.locator(`[data-layout-pane="${id}"]`).boundingBox())?.width ?? 0;

/** Drag the separator before a pane by a distance along x. */
async function dragBefore(page: Page, index: number, distance: number) {
  const box = await page
    .locator('.pierre-layout-separator')
    .nth(index)
    .boundingBox();
  if (box === null) throw new Error('Missing separator');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + distance, y, { steps: 4 });
  await page.mouse.up();
}

test('a sidebar with a size in pixels keeps it when the window narrows', async ({
  page,
}) => {
  expect(await width(page, 'sessions')).toBeCloseTo(240, 0);
  expect(await width(page, 'files')).toBeCloseTo(220, 0);
  const agent = await width(page, 'agent');
  await page.setViewportSize({ width: 1200, height: 900 });
  expect(await width(page, 'sessions')).toBeCloseTo(240, 0);
  expect(await width(page, 'files')).toBeCloseTo(220, 0);
  // The weighted panes share the 240 px that the window lost.
  const shrink = agent - (await width(page, 'agent'));
  expect(shrink).toBeGreaterThan(100);
  expect(shrink).toBeLessThan(240);
});

test('a drag gives a sidebar a new size in pixels, which it keeps', async ({
  page,
}) => {
  // The first separator is the one between the sessions and the agent chat.
  await dragBefore(page, 0, 60);
  expect(await width(page, 'sessions')).toBeCloseTo(300, 0);
  await page.setViewportSize({ width: 1200, height: 900 });
  expect(await width(page, 'sessions')).toBeCloseTo(300, 0);
});

test('a drag stops where a pane reaches its maximum size', async ({ page }) => {
  // The last separator of the row is before the files; a drag to the left
  // grows the files to 360 px at most.
  const separators = page.locator(
    '.pierre-layout-separator[data-direction="horizontal"]'
  );
  await dragBefore(page, (await separators.count()) - 1, -300);
  expect(await width(page, 'files')).toBeCloseTo(360, 0);
});

test('the terminal collapses to its header and expands with its content', async ({
  page,
}) => {
  const terminal = page.locator('[data-layout-pane="terminal"]');
  const content = terminal.locator('.pierre-layout-content');
  await terminal
    .locator('.agent-terminal')
    .evaluate((element) => element.setAttribute('data-kept', 'yes'));
  const before = await terminal.boundingBox();
  const editor = await page
    .locator('[data-layout-pane="editor"]')
    .boundingBox();

  const collapse = terminal.getByRole('button', { name: 'Collapse Terminal' });
  await collapse.click();
  await expect(terminal).toHaveAttribute('data-collapsed', 'true');
  await expect(collapse).toHaveAttribute('aria-pressed', 'true');
  expect((await terminal.boundingBox())?.height).toBeCloseTo(38, 0);
  // The editor takes the space; the content of the terminal stops rendering.
  expect(
    (await page.locator('[data-layout-pane="editor"]').boundingBox())?.height
  ).toBeGreaterThan((editor?.height ?? 0) + 100);
  expect(
    await content.evaluate(
      (element) => getComputedStyle(element).contentVisibility
    )
  ).toBe('hidden');
  await expect(content).toHaveAttribute('inert', '');
  // The tabs of the collapsed stack still change.
  await terminal.getByRole('tab', { name: 'Dev server' }).click();
  await expect(
    page.locator('[data-layout-pane="terminal-server"]')
  ).toHaveAttribute('data-collapsed', 'true');
  await page
    .locator('[data-layout-pane="terminal-server"]')
    .getByRole('tab', { name: 'Terminal' })
    .click();

  await terminal.getByRole('button', { name: 'Collapse Terminal' }).click();
  await expect(terminal).toHaveAttribute('data-collapsed', 'false');
  await expect(content).not.toHaveAttribute('inert', '');
  expect((await terminal.boundingBox())?.height).toBeCloseTo(
    before?.height ?? 0,
    0
  );
  await expect(terminal.locator('.agent-terminal')).toHaveAttribute(
    'data-kept',
    'yes'
  );
});
