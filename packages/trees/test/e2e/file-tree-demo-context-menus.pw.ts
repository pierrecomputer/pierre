import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __fileTreeDemoContextMenuFixtureReady?: boolean;
  }
}

async function openMenuFromTrigger(
  tree: import('@playwright/test').Locator,
  rowPath: string
): Promise<void> {
  const row = tree.locator(
    `button[data-type="item"][data-item-path="${rowPath}"]`
  );
  await row.hover();
  const trigger = tree.locator(
    'button[data-type="context-menu-trigger"][data-visible="true"]'
  );
  await expect(trigger).toBeVisible();
  await trigger.click();
}

async function expectMenuWidth(
  menu: import('@playwright/test').Locator,
  minimumWidth: number
): Promise<void> {
  await expect(menu).toHaveCount(1);
  const box = await menu.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(minimumWidth);
}

test.describe('demo context-menu regressions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/fixtures/file-tree-demo-context-menus.html');
    await page.waitForFunction(
      () => window.__fileTreeDemoContextMenuFixtureReady === true
    );
  });

  test('docs-like portaled menu opens from the trigger button', async ({
    page,
  }) => {
    const tree = page.locator(
      '[data-demo-context-menu-card="radix-portaled"] file-tree-container'
    );

    await openMenuFromTrigger(tree, 'src/index.ts');

    const menu = page.locator(
      '[data-test-context-menu-variant="radix-portaled"]'
    );
    await expect(menu).toBeVisible();
    await expect(
      page.locator('[data-test-menu-action="portaled:src/index.ts"]')
    ).toBeVisible();
  });

  test('docs-like portaled menu opens from right-click', async ({ page }) => {
    const tree = page.locator(
      '[data-demo-context-menu-card="radix-portaled"] file-tree-container'
    );
    const row = tree.locator(
      'button[data-type="item"][data-item-path="src/index.ts"]'
    );

    await row.click();
    await row.click({ button: 'right' });

    const menu = page.locator(
      '[data-test-context-menu-variant="radix-portaled"]'
    );
    await expect(menu).toBeVisible();
    await expect(
      page.locator('[data-test-menu-action="portaled:src/index.ts"]')
    ).toBeVisible();
  });

  test('react client-rendered menu opens from the trigger button', async ({
    page,
  }) => {
    const tree = page.locator(
      '[data-demo-context-menu-card="react-client"] file-tree-container'
    );

    await openMenuFromTrigger(tree, 'src/index.ts');

    const menu = page.locator(
      '[data-test-context-menu-variant="react-client"]'
    );
    await expectMenuWidth(menu, 100);
  });

  test('react client-rendered menu opens from right-click', async ({
    page,
  }) => {
    const tree = page.locator(
      '[data-demo-context-menu-card="react-client"] file-tree-container'
    );
    const row = tree.locator(
      'button[data-type="item"][data-item-path="src/index.ts"]'
    );

    await row.click();
    await row.click({ button: 'right' });

    const menu = page.locator(
      '[data-test-context-menu-variant="react-client"]'
    );
    await expectMenuWidth(menu, 100);
  });
});
