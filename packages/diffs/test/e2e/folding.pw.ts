import { expect, type Locator, type Page, test } from '@playwright/test';

const GUTTER = '[data-code][data-editor-folding] [data-gutter]';
const CONTENT_ROWS = '[data-content] > [data-line]';
const OUTER_TOGGLE = '[data-column-number="1"] [data-fold-toggle]';
const OUTER_INDICATOR =
  '[data-content] > [data-line="1"] > [data-fold-indicator]';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/folding.html');
  await page.waitForFunction(() => window.__foldingReady === true);
}

const renderedLineNumbers = (page: Page): Promise<number[]> =>
  page
    .locator(CONTENT_ROWS)
    .evaluateAll((rows) =>
      rows.map((row) => Number((row as HTMLElement).dataset.line))
    );

const color = (toggle: Locator): Promise<string> =>
  toggle.evaluate((element) => getComputedStyle(element).color);

const firstTokenColor = (page: Page): Promise<string> =>
  page
    .locator('[data-content] > [data-line="1"] [data-char]')
    .first()
    .evaluate((element) => getComputedStyle(element).color);

test.describe('editor folding controls', () => {
  test('reveal on hover and fold or unfold the outer block', async ({
    page,
  }) => {
    await openFixture(page);

    const gutter = page.locator(GUTTER);
    let toggle = page.locator(OUTER_TOGGLE);
    await expect(toggle.locator('use')).toHaveAttribute(
      'href',
      '#diffs-editor-icon-chevron-down'
    );
    await expect(toggle).toHaveCSS('opacity', '0');

    await gutter.hover();
    await expect(toggle).toHaveCSS('opacity', '0.72');
    const gutterHoverColor = await color(toggle);

    await toggle.hover();
    await expect(toggle).toHaveCSS('opacity', '1');
    await expect.poll(() => color(toggle)).not.toBe(gutterHoverColor);

    await toggle.click();
    await expect.poll(() => renderedLineNumbers(page)).toEqual([1, 7, 8]);

    await page.mouse.move(1150, 780);
    toggle = page.locator(OUTER_TOGGLE);
    await expect(toggle).toHaveAttribute('data-folded', '');
    await expect(toggle.locator('use')).toHaveAttribute(
      'href',
      '#diffs-editor-icon-chevron-right'
    );
    await expect(toggle).toHaveCSS('opacity', '0.72');

    const indicator = page.locator(OUTER_INDICATOR);
    const ellipsis = indicator.locator('[data-fold-ellipsis]');
    await expect(indicator).toBeVisible();
    await expect(ellipsis.locator('use')).toHaveAttribute(
      'href',
      '#diffs-editor-icon-ellipsis'
    );
    expect(await indicator.getAttribute('data-fold-end-text')).toBeNull();
    await expect(indicator).toHaveText('');
    await expect(page.locator('[data-content] > [data-line="7"]')).toHaveText(
      '}'
    );

    const ellipsisBox = await ellipsis.boundingBox();
    const indicatorBox = await indicator.boundingBox();
    expect(ellipsisBox).not.toBeNull();
    expect(indicatorBox).not.toBeNull();
    expect(indicatorBox!.width).toBeCloseTo(ellipsisBox!.width, 5);

    const darkTokenColor = await firstTokenColor(page);
    await ellipsis.focus();
    await expect(ellipsis).toBeFocused();
    await page.evaluate(() => window.__setFoldingTheme?.());
    await expect.poll(() => firstTokenColor(page)).not.toBe(darkTokenColor);
    await expect(ellipsis).toBeFocused();

    await ellipsis.click();
    await expect
      .poll(() => renderedLineNumbers(page))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(indicator).toHaveCount(0);

    await page.mouse.move(1150, 780);
    toggle = page.locator(OUTER_TOGGLE);
    await expect(toggle).not.toHaveAttribute('data-folded', '');
    await expect(toggle.locator('use')).toHaveAttribute(
      'href',
      '#diffs-editor-icon-chevron-down'
    );
    await expect(toggle).toHaveCSS('opacity', '0');
  });
});
