import { expect, type Page, test } from '@playwright/test';

// Playwright CSS locators pierce the open shadow root, so all selectors below
// resolve against the `diffs-container` shadow DOM without extra ceremony.
const ADDITIONS = '[data-code][data-additions] [data-content]';
const DELETIONS = '[data-code][data-deletions] [data-content]';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/diff-render.html');
  await page.waitForFunction(() => window.__diffReady === true);
}

test.describe('diff rendering', () => {
  test('renders additions and deletions with the expected line types', async ({
    page,
  }) => {
    await openFixture(page);

    const additions = page.locator(
      `${ADDITIONS} [data-line-type="change-addition"]`
    );
    await expect(additions).toHaveCount(2);
    await expect(additions.first()).toHaveText('  return `hi ${name}!`;');
    await expect(additions.nth(1)).toHaveText('  return `bye ${name}!`;');

    const deletions = page.locator(
      `${DELETIONS} [data-line-type="change-deletion"]`
    );
    await expect(deletions).toHaveCount(2);
    await expect(deletions.first()).toHaveText("  return 'hi ' + name;");

    // Syntax highlighting splits a code line into multiple token spans; assert
    // more than one so we know the highlighter actually ran in the browser.
    expect(
      await additions.first().evaluate((el) => el.childElementCount)
    ).toBeGreaterThan(1);
  });

  test('toggling between split and unified changes the layout', async ({
    page,
  }) => {
    await openFixture(page);

    // Split view renders separate additions and deletions columns.
    await expect(page.locator('[data-code][data-additions]')).toHaveCount(1);
    await expect(page.locator('[data-code][data-deletions]')).toHaveCount(1);
    await expect(page.locator('[data-code][data-unified]')).toHaveCount(0);

    await page.locator('[data-toggle-style]').click();

    // Unified view collapses to a single column.
    await expect(page.locator('[data-current-style]')).toHaveText('unified');
    await expect(page.locator('[data-code][data-unified]')).toHaveCount(1);
    await expect(page.locator('[data-code][data-additions]')).toHaveCount(0);
    await expect(page.locator('[data-code][data-deletions]')).toHaveCount(0);
  });

  test('clicking a hunk separator expands collapsed context', async ({
    page,
  }) => {
    await openFixture(page);

    const expanded = page.locator(
      `${ADDITIONS} [data-line-type="context-expanded"]`
    );
    await expect(expanded).toHaveCount(0);
    await expect(page.locator('[data-expand-button]').first()).toBeVisible();

    await page.locator('[data-expand-button]').first().click();

    // The previously hidden unchanged lines are revealed as expanded context
    // and the separators that offered the expansion are consumed.
    await expect(expanded.first()).toBeVisible();
    await expect(page.locator('[data-expand-button]')).toHaveCount(0);
  });

  test('rejecting a hunk removes its addition from the diff', async ({
    page,
  }) => {
    await openFixture(page);

    const additions = page.locator(
      `${ADDITIONS} [data-line-type="change-addition"]`
    );
    await expect(additions).toHaveCount(2);

    await page.locator('[data-reject-hunk]').click();

    // The first hunk's change is reverted, so only the second addition remains.
    await expect(additions).toHaveCount(1);
    await expect(additions.first()).toHaveText('  return `bye ${name}!`;');
  });
});
