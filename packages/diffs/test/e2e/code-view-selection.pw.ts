import { expect, type Page, test } from '@playwright/test';

// The fixture's window helpers (see fixtures/code-view-selection.html).
// Selections are [startLine, startChar, endLine, endChar, direction].
type SelectionTuple = [number, number, number, number, number];

declare global {
  interface Window {
    __selectionReady?: boolean;
    __selection?: {
      selections(): SelectionTuple[];
      pointAt(line: number, character: number): { x: number; y: number };
    };
  }
}

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/code-view-selection.html');
  await page.waitForFunction(() => window.__selectionReady === true);
}

function pointAt(
  page: Page,
  line: number,
  character: number
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([line, character]) => window.__selection!.pointAt(line, character),
    [line, character]
  );
}

// Waits for `count` animation frames, long enough for the editor's deferred
// refocus and any selectionchange it causes to be handled.
async function frames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (count) => {
    for (let index = 0; index < count; index++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }, count);
}

function selections(page: Page): Promise<SelectionTuple[]> {
  return page.evaluate(() => window.__selection!.selections());
}

// After each keyboard selection step the editor writes the window selection
// itself and ignores the selectionchange that causes for two frames. Browsers
// can deliver it later than that, which collapsed the selection to its anchor
// at random. Dispatching the event after the window closes makes that late
// delivery deterministic.
test('a late selectionchange keeps a Shift+Down selection', async ({
  page,
}) => {
  await openFixture(page);
  const from = await pointAt(page, 1, 3);
  const to = await pointAt(page, 4, 6);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => selections(page)).toEqual([[1, 3, 4, 6, 1]]);

  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowDown');
  await frames(page, 5);
  const extended = await selections(page);
  expect(extended[0].slice(0, 2)).toEqual([1, 3]);
  expect(extended[0][2]).toBeGreaterThan(4);

  await page.evaluate(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
  await frames(page, 2);
  await page.keyboard.up('Shift');

  expect(await selections(page)).toEqual(extended);
});

test('clicking the anchor of a keyboard selection clears it', async ({
  page,
}) => {
  await openFixture(page);
  const anchor = await pointAt(page, 1, 5);
  await page.mouse.click(anchor.x, anchor.y);
  await expect.poll(() => selections(page)).toEqual([[1, 5, 1, 5, 0]]);

  for (let index = 0; index < 3; index++) {
    await page.keyboard.press('Shift+ArrowDown');
  }
  const [[, , endLine]] = await selections(page);
  expect(endLine).toBeGreaterThan(1);

  await page.mouse.click(anchor.x, anchor.y);
  await expect.poll(() => selections(page)).toEqual([[1, 5, 1, 5, 0]]);
});
