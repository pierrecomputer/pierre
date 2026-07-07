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
});
