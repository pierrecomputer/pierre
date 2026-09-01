import { expect, type Page, test } from '@playwright/test';

// Playwright CSS locators pierce the open shadow root, so all selectors below
// resolve against the `diffs-container` shadow DOM without extra ceremony.
const ADDITIONS = '[data-code][data-additions] [data-content]';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/chamele.html');
  await page.waitForFunction(() => window.__chameleReady === true);
}

test.describe('chamele highlighter', () => {
  test('renders diff rows highlighted by the chamele wasm lexers', async ({
    page,
  }) => {
    await openFixture(page);

    const addition = page.locator(
      `${ADDITIONS} [data-line-type="change-addition"]`
    );
    await expect(addition).toHaveText('  return `hi ${name}!`;');

    // Real tokenization splits the line into multiple spans, proving the
    // chamele wasm module resolved and ran in the browser.
    expect(
      await addition.evaluate((el) => el.childElementCount)
    ).toBeGreaterThan(1);

    // The rendered tokens carry chamele's pierre-dark palette (the keyword
    // color below is emitted by the chamele theme compiler).
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

  test('a registered chamele highlighter keeps work off the worker pool', async ({
    page,
  }) => {
    await openFixture(page);

    // Before registration the pool accepts work; after, every render routes
    // to the main thread because workers always highlight with shiki.
    expect(await page.evaluate(() => window.__poolWorkingWithShiki)).toBe(true);
    expect(await page.evaluate(() => window.__poolWorkingWithChamele)).toBe(
      false
    );
  });
});
