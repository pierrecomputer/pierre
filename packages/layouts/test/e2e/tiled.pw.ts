import { expect, type Page, test } from '@playwright/test';

// App B of the modular entry points (demo/tiled.tsx): `paneDrag()` with
// `Layout.MoveHandle`, the drag engine, and `corners()`.

const host = (page: Page, id: string) =>
  page.locator(`[data-layouts-pane="${id}"]`);

const box = async (page: Page, selector: string) => {
  const value = await page.locator(selector).first().boundingBox();
  if (value === null) throw new Error(`No box: ${selector}`);
  return value;
};

const center = (value: {
  x: number;
  y: number;
  width: number;
  height: number;
}) => ({
  x: value.x + value.width / 2,
  y: value.y + value.height / 2,
});

function warningsOf(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  return warnings;
}

// Press the move handle of a pane, and move the pointer to a point.
async function dragHandle(
  page: Page,
  id: string,
  to: { x: number; y: number }
) {
  const handle = center(
    await box(page, `[data-layouts-pane="${id}"] .pierre-layouts-grip`)
  );
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('a move handle drags a pane to an edge of another pane', async ({
  page,
}) => {
  await page.goto('/tiled.html');
  const beta = await box(page, '[data-layouts-pane="b"]');
  await dragHandle(page, 'a', {
    x: beta.x + beta.width - 10,
    y: beta.y + beta.height / 2,
  });
  // The drag shows the drop, marks the pane and its handle, and announces.
  const drop = await box(page, '.pierre-layouts-drop');
  expect(drop.x).toBeGreaterThan(beta.x + beta.width / 2 - 2);
  await expect(host(page, 'a')).toHaveAttribute('data-moving', 'true');
  await expect(host(page, 'a').locator('.pierre-layouts-grip')).toHaveAttribute(
    'data-dragging',
    'true'
  );
  await expect(page.getByRole('status')).toHaveText(
    'Move Alpha to the right of Beta'
  );
  await page.mouse.up();
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(0);
  await expect(host(page, 'a')).not.toHaveAttribute('data-moving');
  const alpha = await box(page, '[data-layouts-pane="a"]');
  const next = await box(page, '[data-layouts-pane="b"]');
  expect(alpha.x).toBeGreaterThan(next.x);
  expect(Math.abs(alpha.y - next.y)).toBeLessThan(2);
  // The move operation announces its result with the titles of the panes.
  await expect(page.getByRole('status')).toHaveText(
    'Alpha moved to the right of Beta'
  );
});

test('Escape ends a drag with no move', async ({ page }) => {
  await page.goto('/tiled.html');
  const before = await box(page, '[data-layouts-pane="a"]');
  const delta = await box(page, '[data-layouts-pane="d"]');
  await dragHandle(page, 'a', {
    x: delta.x + delta.width / 2,
    y: delta.y + delta.height - 10,
  });
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(0);
  expect(await box(page, '[data-layouts-pane="a"]')).toEqual(before);
});

test('a zoom disables the move handles', async ({ page }) => {
  await page.goto('/tiled.html');
  await page.getByRole('button', { name: 'Zoom Alpha' }).click();
  const grip = host(page, 'a').locator('.pierre-layouts-grip');
  await expect(grip).toHaveAttribute('aria-disabled', 'true');
  await expect(grip).toHaveCSS('cursor', 'default');
  await dragHandle(page, 'a', { x: 20, y: 20 });
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(0);
  await page.mouse.up();
  await expect(host(page, 'a')).toHaveAttribute('data-zoomed', 'true');
});

test('the move handle and the corners set their gesture styles inline', async ({
  page,
}) => {
  await page.goto('/tiled.html');
  const grip = host(page, 'a').locator('.pierre-layouts-grip');
  await expect(grip).toHaveAccessibleName('Drag Alpha');
  await expect(grip).not.toHaveAttribute('aria-haspopup');
  await expect(grip).toHaveCSS('cursor', 'grab');
  await expect(grip).toHaveCSS('touch-action', 'none');
  const corner = page.locator('.pierre-layouts-corner').first();
  await expect(corner).toHaveAttribute('aria-hidden', 'true');
  await expect(corner).toHaveCSS('cursor', 'move');
});

test('a corner resizes the separators that meet at it', async ({ page }) => {
  await page.goto('/tiled.html');
  const alpha = await box(page, '[data-layouts-pane="a"]');
  const gamma = await box(page, '[data-layouts-pane="c"]');
  const corner = center(await box(page, '.pierre-layouts-corner'));
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 60, corner.y + 40, { steps: 4 });
  await page.mouse.up();
  const nextAlpha = await box(page, '[data-layouts-pane="a"]');
  const nextGamma = await box(page, '[data-layouts-pane="c"]');
  expect(nextAlpha.width - alpha.width).toBeGreaterThan(50);
  expect(nextAlpha.height - alpha.height).toBeGreaterThan(30);
  // The corner of the bottom row is at the same point, so it moves too.
  expect(nextGamma.width - gamma.width).toBeGreaterThan(50);
});

test('the corners hide while a pane is zoomed', async ({ page }) => {
  await page.goto('/tiled.html');
  await expect(page.locator('.pierre-layouts-corner')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Zoom Alpha' }).click();
  await expect(page.locator('.pierre-layouts-corner')).toHaveCount(0);
});

test('a move handle without paneDrag() and paneDrag() without edits() warn', async ({
  page,
}) => {
  const warnings = warningsOf(page);
  await page.goto('/tiled.html?features=nodrag');
  await expect(page.locator('[data-layouts-pane]')).toHaveCount(4);
  expect(
    warnings.filter((text) =>
      text.includes('Layout.MoveHandle needs paneDrag()')
    )
  ).toHaveLength(1);
  // Without arrange(), a handle is a drag handle only: no path with no drag.
  expect(
    warnings.filter((text) =>
      text.includes('Layout.MoveHandle needs arrange()')
    )
  ).toHaveLength(1);
  await page.goto('/tiled.html?features=noedits');
  await expect(page.locator('[data-layouts-pane]')).toHaveCount(4);
  expect(
    warnings.filter((text) =>
      text.includes('the feature pane-drag needs the feature edits')
    )
  ).toHaveLength(1);
});

test('canDrop refuses a place: no preview, no status, and no move', async ({
  page,
}) => {
  await page.goto('/tiled.html?refuse=left');
  const before = await box(page, '[data-layouts-pane="a"]');
  const beta = await box(page, '[data-layouts-pane="b"]');
  await dragHandle(page, 'a', { x: beta.x + 10, y: beta.y + beta.height / 2 });
  await expect(host(page, 'a')).toHaveAttribute('data-moving', 'true');
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(0);
  await expect(page.getByRole('status')).not.toHaveText(/^Move /);
  await page.mouse.up();
  expect(await box(page, '[data-layouts-pane="a"]')).toEqual(before);
  // An allowed place still drops.
  await dragHandle(page, 'a', {
    x: beta.x + beta.width - 10,
    y: beta.y + beta.height / 2,
  });
  await expect(page.locator('.pierre-layouts-drop')).toHaveCount(1);
  await page.mouse.up();
  await expect
    .poll(async () => (await box(page, '[data-layouts-pane="a"]')).x)
    .toBeGreaterThan(before.x + 10);
});

test('a move or a new pane at an edge of the layout says where it went', async ({
  page,
}) => {
  await page.goto('/tiled.html');
  const status = page.locator('.pierre-layouts > [role="status"]');
  const run = (name: string, ...args: unknown[]) =>
    page.evaluate(
      ([name, args]) => {
        const layout = (
          window as unknown as {
            __tiled: {
              layout: Record<string, (...args: unknown[]) => void>;
            };
          }
        ).__tiled.layout;
        layout[name as string](...(args as unknown[]));
      },
      [name, args]
    );
  await run('move', 'd', 'rows', 'left');
  await expect(status).toHaveText('Delta moved to a new column at the left');
  await expect(host(page, 'd')).toHaveAttribute(
    'data-edges',
    'top bottom left'
  );
  const root = await page.evaluate(
    () =>
      (
        window as unknown as {
          __tiled: { layout: { getSnapshot(): { root: { id: string } } } };
        }
      ).__tiled.layout.getSnapshot().root.id
  );
  await run('split', root, { type: 'pane', id: 'e' }, 'bottom');
  await expect(status).toHaveText('e opened in a new row at the bottom');
  // Beside a stack, or a pane, the announcement names the pane.
  await run('move', 'a', 'b', 'right');
  await expect(status).toHaveText('Alpha moved to the right of Beta');
});
