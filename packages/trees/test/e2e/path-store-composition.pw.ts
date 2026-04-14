import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __pathStoreCompositionFixtureReady?: boolean;
  }
}

test.describe('path-store composition surfaces', () => {
  test('keeps the context-menu shell slotted in light DOM while anchoring from the shadow tree', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/path-store-composition.html');
    await page.waitForFunction(
      () => window.__pathStoreCompositionFixtureReady === true
    );

    await expect(
      page.locator('file-tree-container [slot="header"]')
    ).toHaveText('Path-store header');

    const secondRow = page.locator(
      'file-tree-container button[data-item-path="src/index.ts"]'
    );
    await secondRow.click();
    await secondRow.click({ button: 'right' });

    await expect(page.locator('[data-test-path-store-menu]')).toBeVisible();

    const shellState = await page.evaluate(() => {
      const host = document.querySelector('file-tree-container');
      const shadowRoot = host?.shadowRoot;
      const anchor = shadowRoot?.querySelector(
        '[data-type="context-menu-anchor"]'
      );
      return {
        anchorTop: anchor instanceof HTMLElement ? anchor.style.top : null,
        lightDomMenu: host?.querySelector('[slot="context-menu"]') != null,
        shadowDomMenu:
          shadowRoot?.querySelector('[slot="context-menu"]') != null,
      };
    });

    expect(shellState.lightDomMenu).toBe(true);
    expect(shellState.shadowDomMenu).toBe(false);
    expect(shellState.anchorTop).not.toBeNull();
    expect(shellState.anchorTop).not.toBe('0px');

    await page.locator('[data-test-path-store-menu-close]').click();
    await expect(page.locator('[data-test-path-store-menu]')).toHaveCount(0);
  });
});
