import { expect, type Page, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app');
  // Five places; the agent chat and the terminal have two tabs each.
  await expect(page.locator('[data-layouts-pane]')).toHaveCount(7);
});

const host = (page: Page, id: string) =>
  page.locator(`[data-layouts-pane="${id}"]`);

test('a hidden pane keeps its content and shows again in its place', async ({
  page,
}) => {
  const terminal = host(page, 'terminal');
  const before = await terminal.boundingBox();
  // Mark the content, so that a new mount would lose the mark.
  await terminal
    .locator('.agent-terminal')
    .evaluate((element) => element.setAttribute('data-kept', 'yes'));

  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(terminal).toHaveAttribute('data-hidden', 'true');
  await expect(terminal).toHaveAttribute('inert', '');
  expect(
    await terminal.evaluate(
      (element) => getComputedStyle(element).contentVisibility
    )
  ).toBe('hidden');
  // The editor above it takes its space.
  const editor = await host(page, 'editor').boundingBox();
  expect(editor?.height).toBeGreaterThan((before?.height ?? 0) + 100);

  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(terminal).not.toHaveAttribute('data-hidden');
  await expect(terminal.locator('.agent-terminal')).toHaveAttribute(
    'data-kept',
    'yes'
  );
  const after = await terminal.boundingBox();
  expect(after?.height).toBeCloseTo(before?.height ?? 0, 0);
});

test('a pane that shows again grows into its place while the panes beside it move', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const terminal = host(page, 'terminal');
  // The layout's own animations; pane content can run others.
  const finishLayoutAnimations = () =>
    page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.id === 'pierre-layouts-flip')
          .map((animation) => animation.finished)
      )
    );
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(terminal).toHaveAttribute('data-hidden', 'true');
  await finishLayoutAnimations();

  // Show the terminal, hold the layout's animations at their middle, and read
  // its height there and at the end. It sits below the editor, so it grows in
  // height. React renders the click's update in a microtask.
  const [middle, end] = await terminal.evaluate(async (element) => {
    Array.from(
      document.querySelectorAll<HTMLButtonElement>('.app-toggles button')
    )
      .find((button) => button.textContent === 'Terminal')
      ?.click();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const animations = document
      .getAnimations()
      .filter((animation) => animation.id === 'pierre-layouts-flip');
    for (const animation of animations) {
      animation.pause();
      animation.currentTime =
        Number(animation.effect?.getTiming().duration ?? 0) / 2;
    }
    const height = element.getBoundingClientRect().height;
    for (const animation of animations) animation.finish();
    return [height, element.getBoundingClientRect().height];
  });
  expect(middle).toBeGreaterThan(1);
  expect(middle).toBeLessThan(end - 1);

  // With reduced motion, the pane shows at once.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(terminal).toHaveAttribute('data-hidden', 'true');
  const running = await terminal.evaluate(async (element) => {
    Array.from(
      document.querySelectorAll<HTMLButtonElement>('.app-toggles button')
    )
      .find((button) => button.textContent === 'Terminal')
      ?.click();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    return element.getAnimations().length;
  });
  expect(running).toBe(0);
  await expect(terminal).not.toHaveAttribute('data-hidden');
});

test('the close button of a tool hides it, and each pane has its own buttons', async ({
  page,
}) => {
  await expect(host(page, 'sessions').locator('header > button')).toHaveCount(
    0
  );
  await expect(
    host(page, 'agent').getByRole('button', { name: /^Close / })
  ).toHaveCount(0);
  await expect(
    host(page, 'agent').getByRole('button', { name: /^Drag / })
  ).toHaveCount(1);
  for (const id of ['editor', 'files'])
    await expect(host(page, id).locator('header > button')).toHaveCount(3);
  // The terminal also has a collapse button.
  await expect(host(page, 'terminal').locator('header > button')).toHaveCount(
    4
  );

  await page.getByRole('button', { name: 'Close Files', exact: true }).click();
  await expect(host(page, 'files')).toHaveAttribute('data-hidden', 'true');
  await expect(
    page.getByRole('button', { name: 'Files', exact: true })
  ).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(host(page, 'files')).not.toHaveAttribute('data-hidden');
});

test('panes and the zoom change at once when their animations are off', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Click a button and count the running animations of the layout in the
  // next task. React commits the store change in a microtask after the
  // click, and the view starts its FLIP animations in a layout effect. A
  // count in the next frame can come after a 240 ms animation ends on a busy
  // machine; the next task comes before.
  const clickAndCount = (name: string) =>
    page.evaluate(async (label) => {
      const button = [...document.querySelectorAll('button')].find(
        (element) =>
          element.getAttribute('aria-label') === label ||
          (!element.hasAttribute('aria-label') &&
            element.textContent?.trim() === label)
      );
      if (button === undefined) throw new Error(`Missing button: ${label}`);
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return (
        document
          .querySelector('.pierre-layouts')
          ?.getAnimations({ subtree: true })
          .filter((animation) => animation.id === 'pierre-layouts-flip')
          .length ?? 0
      );
    }, name);

  expect(await clickAndCount('Files')).toBeGreaterThan(0);
  await expect(host(page, 'files')).toHaveAttribute('data-hidden', 'true');

  await page.getByLabel('Animate panes').uncheck();
  await page.waitForTimeout(400);
  expect(await clickAndCount('Files')).toBe(0);
  await expect(host(page, 'files')).not.toHaveAttribute('data-hidden');

  expect(await clickAndCount('Zoom Editor')).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Zoom Editor', exact: true }).click();
  await page.waitForTimeout(400);

  await page.getByLabel('Animate zoom').uncheck();
  expect(await clickAndCount('Zoom Editor')).toBe(0);
  await expect(host(page, 'editor')).toHaveAttribute('data-zoomed', 'true');
});

test('each pane host is its own compositor layer only when paneLayers asks for it', async ({
  page,
}) => {
  // A pane host is a layer when its transform is 3D.
  const layered = (id: string) =>
    host(page, id).evaluate(
      (element) =>
        !(element.computedStyleMap().get('transform') as CSSTransformValue).is2D
    );
  // The app shows 5 panes, fewer than the 6 from which the layers start by default.
  expect(await layered('agent')).toBe(false);
  await page.getByLabel('Pane layers').selectOption('on');
  expect(await layered('agent')).toBe(true);
  await page.getByLabel('Pane layers').selectOption('off');
  expect(await layered('agent')).toBe(false);
  await page.getByLabel('Pane layers').selectOption('auto');
  expect(await layered('agent')).toBe(false);
  await page.getByLabel('Pane layers').selectOption('on');
  expect(await layered('agent')).toBe(true);
  // A covered pane moves out with a 2D transform, so it is not a layer.
  await page.getByRole('button', { name: 'Zoom Editor', exact: true }).click();
  await expect(host(page, 'agent')).toHaveAttribute('data-covered', 'zoom');
  expect(await layered('agent')).toBe(false);
  expect(await layered('editor')).toBe(true);
});

test('a separator drag changes only the panes beside it in the n-ary model', async ({
  page,
}) => {
  // A wide window, so that the binary model leaves the editor above its
  // minimum size: it nests the sidebars, and its nested splits take weights.
  await page.setViewportSize({ width: 1440, height: 900 });
  const width = async (id: string): Promise<number> =>
    (await host(page, id).boundingBox())?.width ?? 0;
  // The first separator is the one between the sessions and the agent chat.
  const drag = async (distance: number): Promise<void> => {
    const box = await page
      .locator('.pierre-layouts-separator')
      .first()
      .boundingBox();
    if (box === null) throw new Error('Missing separator');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + distance, y, { steps: 4 });
    await page.mouse.up();
  };

  const sessions = await width('sessions');
  const agent = await width('agent');
  const editor = await width('editor');
  const files = await width('files');
  await drag(80);
  expect(await width('sessions')).toBeCloseTo(sessions + 80, 0);
  expect(await width('agent')).toBeCloseTo(agent - 80, 0);
  expect(await width('editor')).toBeCloseTo(editor, 0);
  expect(await width('files')).toBeCloseTo(files, 0);
});

test('a new title from getPaneTitle reaches the tab, the tab list, and the names of the buttons', async ({
  page,
}) => {
  const agent = host(page, 'agent');
  const first = 'Resize drags with heavy content';
  const next = 'Hide panes under a zoomed pane';
  await expect(agent.getByRole('tab', { name: first })).toHaveCount(1);
  await page
    .getByRole('navigation', { name: 'Sessions' })
    .getByRole('button', { name: next })
    .click();
  await expect(agent).toHaveAccessibleName(next);
  await expect(agent.getByRole('tab', { name: next })).toHaveCount(1);
  await expect(agent.getByRole('tab', { name: first })).toHaveCount(0);
  await expect(agent.getByRole('tablist')).toHaveAccessibleName(
    `Tabs of ${next}`
  );
  await expect(agent.getByRole('button', { name: `Zoom ${next}` })).toHaveCount(
    1
  );
  await expect(agent.getByRole('button', { name: `Drag ${next}` })).toHaveCount(
    1
  );
});

test('the close mark of a tab is a pointer target of 24 CSS pixels', async ({
  page,
}) => {
  const mark = page
    .locator('[role="tab"][aria-selected="true"] .pierre-layouts-tab-close')
    .first();
  await expect(mark).toBeVisible();
  // The mark shows 16 px; a press up to 12 px from its middle reaches it.
  const hits = await mark.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    return [
      [-11.5, 0],
      [11.5, 0],
      [0, -11.5],
      [0, 11.5],
    ].map(([dx, dy]) => document.elementFromPoint(x + dx, y + dy) === element);
  });
  expect(hits).toEqual([true, true, true, true]);
  expect((await mark.boundingBox())?.width).toBe(16);
});
