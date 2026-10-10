import { expect, type Page, test } from '@playwright/test';

const gutterRow = (lineNumber: number): string =>
  `[data-gutter] [data-column-number="${lineNumber}"]`;

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/line-select.html');
  await page.waitForFunction(() => window.__lineSelectReady === true);
}

const selectionChanges = (page: Page): Promise<(E2ELineRange | null)[]> =>
  page.evaluate(() => window.__selectionChanges ?? []);
const gutterClicks = (page: Page): Promise<E2ELineRange[]> =>
  page.evaluate(() => window.__gutterClicks ?? []);

test.describe('line selection and gutter utility', () => {
  test('clicking a gutter line number selects that line', async ({ page }) => {
    await openFixture(page);

    await page.locator(gutterRow(2)).click();

    // A selected line marks both its gutter and content rows; scope to the
    // gutter so the count is one per selected line, and confirm it is line 2.
    await expect(
      page.locator('[data-gutter] [data-selected-line]')
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-gutter] [data-column-number="2"][data-selected-line]`)
    ).toHaveCount(1);
  });

  test('dragging down the gutter selects a range of lines', async ({
    page,
  }) => {
    await openFixture(page);

    const from = await page.locator(gutterRow(2)).boundingBox();
    const to = await page.locator(gutterRow(4)).boundingBox();
    if (from == null || to == null) {
      throw new Error('missing gutter rows');
    }

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 5,
    });
    await page.mouse.up();

    // Lines 2 through 4 end up selected (counted on the gutter side).
    await expect(
      page.locator('[data-gutter] [data-selected-line]')
    ).toHaveCount(3);
    await expect
      .poll(() => selectionChanges(page))
      .toContainEqual({ start: 2, end: 4 });
  });

  test('hovering a gutter row reveals a utility button that reports its line', async ({
    page,
  }) => {
    await openFixture(page);

    await page.locator(gutterRow(3)).hover();
    const utility = page.locator('[data-utility-button]');
    await expect(utility).toBeVisible();

    await utility.click();
    await expect
      .poll(() => gutterClicks(page))
      .toContainEqual({
        start: 3,
        end: 3,
      });
  });

  // Regression guard for pierre#1184: during a native text-selection drag the
  // gutter utility must not be re-parented into the hovered line's number cell
  // on every pointermove. That mid-drag DOM mutation crashes WebKit's
  // web-content process (EventHandler::handleMouseDraggedEvent). Asserting the
  // utility stays frozen guards the fix on every browser, including those whose
  // WebKit build does not happen to crash.
  test('a native text-selection drag does not move the gutter utility', async ({
    page,
  }) => {
    await openFixture(page);

    // Reveal the utility on line 2 via hover (no button held).
    await page.locator(gutterRow(2)).hover();
    await expect(page.locator('[data-utility-button]')).toBeVisible();

    const utilityLine = (): Promise<string | null> =>
      page.evaluate(() => {
        const host = document.querySelector('diffs-container');
        const button = host?.shadowRoot?.querySelector('[data-utility-button]');
        const cell = button?.closest('[data-column-number]');
        return cell?.getAttribute('data-column-number') ?? null;
      });

    expect(await utilityLine()).toBe('2');

    const row2 = await page.locator(gutterRow(2)).boundingBox();
    const row5 = await page.locator(gutterRow(5)).boundingBox();
    const content = await page.locator('[data-content]').first().boundingBox();
    if (row2 == null || row5 == null || content == null) {
      throw new Error('missing fixture geometry');
    }

    // Press on the CONTENT (not the gutter) so a native text selection starts
    // instead of a line-selection session, then drag down across lines with
    // the button held.
    const x = content.x + content.width / 2;
    await page.mouse.move(x, row2.y + row2.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, row5.y + row5.height / 2, { steps: 8 });
    // Utility stays on line 2 while the drag is in progress.
    expect(await utilityLine()).toBe('2');
    await page.mouse.up();
    expect(await utilityLine()).toBe('2');
  });
});
