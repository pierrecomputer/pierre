import { expect, type Page, test } from '@playwright/test';

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/style-isolation.html');
  await page.waitForFunction(() => window.__fileTreeFixtureReady === true);
}

test.describe('file-tree shadow style isolation', () => {
  test('external id selector does not style shadow-root node with same id', async ({
    page,
  }) => {
    await openFixture(page);

    const colors = await page.evaluate(() => {
      const outside = document.querySelector(
        '[data-test-outside-duplicate-id]'
      );
      const host = document.getElementById('test-tree-host');
      const inside = host?.shadowRoot?.querySelector(
        '[data-test-shadow-dup-id]'
      );
      return {
        outside: outside != null ? getComputedStyle(outside).color : null,
        inside: inside != null ? getComputedStyle(inside).color : null,
      };
    });

    expect(colors.outside).toBe('rgb(0, 128, 0)');
    expect(colors.inside).not.toBe('rgb(0, 128, 0)');
  });

  test('file-tree internal selected-item styles do not leak to light DOM', async ({
    page,
  }) => {
    await openFixture(page);

    const styles = await page.evaluate(() => {
      const outside = document.querySelector('[data-test-outside-pseudo-item]');
      if (outside == null) {
        return null;
      }
      const computed = getComputedStyle(outside);
      return {
        backgroundColor: computed.backgroundColor,
        boxShadow: computed.boxShadow,
      };
    });

    expect(styles).not.toBeNull();
    expect(styles?.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(styles?.boxShadow).toBe('none');
  });

  test('css custom properties flow into the shadow root for theming', async ({
    page,
  }) => {
    await openFixture(page);

    const selectedBackground = await page.evaluate(() => {
      const host = document.getElementById('test-tree-host');
      const selected = host?.shadowRoot?.querySelector(
        '[data-test-selected-item]'
      );
      return selected != null
        ? getComputedStyle(selected).backgroundColor
        : null;
    });

    expect(selectedBackground).toBe('rgb(1, 2, 3)');
  });
});

declare global {
  interface Window {
    __fileTreeFixtureReady?: boolean;
  }
}
