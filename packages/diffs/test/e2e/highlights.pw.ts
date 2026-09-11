import { expect, type Page, test } from '@playwright/test';

// Playwright CSS locators pierce the open shadow root, so all selectors below
// resolve against the `diffs-container` shadow DOM without extra ceremony.
const ADDITIONS = '[data-code][data-additions] [data-content]';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/highlights.html');
  await page.waitForFunction(() => window.__highlightsReady === true);
}

test.describe('highlights highlighter', () => {
  test('renders diff rows highlighted by the highlights wasm lexers', async ({
    page,
  }) => {
    await openFixture(page);

    const addition = page.locator(
      `${ADDITIONS} [data-line-type="change-addition"]`
    );
    await expect(addition).toHaveText('  return `hi ${name}!`;');

    // Real tokenization splits the line into multiple spans, proving the
    // highlights wasm module resolved and ran in the browser.
    expect(
      await addition.evaluate((el) => el.childElementCount)
    ).toBeGreaterThan(1);

    // The rendered tokens carry highlights's pierre-dark palette (the keyword
    // color below is emitted by the highlights theme compiler).
    const keywordColors = await page
      .locator(`${ADDITIONS} [data-line-type="context"]`)
      .first()
      .evaluate((el) =>
        Array.from(el.querySelectorAll('span'), (span) =>
          span.getAttribute('style')
        )
      );
    expect(
      keywordColors.some((style) => style?.includes('#ff678d') === true)
    ).toBe(true);
  });

  test('a registered highlights highlighter keeps work off the worker pool', async ({
    page,
  }) => {
    await openFixture(page);

    // The warm-up file reached the worker. Rendering the connected diff with
    // Highlights must finish without sending any additional highlight work.
    expect(await page.evaluate(() => window.__poolWorkingWithShiki)).toBe(true);
    expect(await page.evaluate(() => window.__poolWorkingWithHighlights)).toBe(
      false
    );
    expect(await page.evaluate(() => window.__highlightWorkerRequests)).toEqual(
      ['file']
    );
  });
});
