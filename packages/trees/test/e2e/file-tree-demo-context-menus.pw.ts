import { expect, type Page, test } from '@playwright/test';

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

async function readLaneSnapshot(page: Page, card: string, rowPath: string) {
  return page
    .locator(`[data-demo-context-menu-card="${card}"] file-tree-container`)
    .evaluate((host, targetPath) => {
      if (
        !(host instanceof HTMLElement) ||
        !(host.shadowRoot instanceof ShadowRoot)
      ) {
        return null;
      }

      const shadowRoot = host.shadowRoot;
      const treeRoot = shadowRoot.querySelector('[role="tree"]');
      const row = shadowRoot.querySelector(
        `button[data-item-path="${targetPath}"]`
      );
      if (!(row instanceof HTMLButtonElement)) {
        return null;
      }

      return {
        actionLaneButtonCount: row.querySelectorAll(
          '[data-item-section="action"] button'
        ).length,
        actionLaneCount: row.querySelectorAll('[data-item-section="action"]')
          .length,
        ariaHiddenDecorativeCount: row.querySelectorAll(
          '[data-item-action-affordance="decorative"][aria-hidden="true"]'
        ).length,
        decorativeAffordanceCount: row.querySelectorAll(
          '[data-item-action-affordance="decorative"]'
        ).length,
        realTriggerCount: shadowRoot.querySelectorAll(
          '[data-type="context-menu-trigger"]'
        ).length,
        rootButtonVisibility:
          treeRoot?.getAttribute(
            'data-file-tree-context-menu-button-visibility'
          ) ?? null,
        rootHasActionLane:
          treeRoot?.getAttribute(
            'data-file-tree-has-context-menu-action-lane'
          ) ?? null,
        rootTriggerMode:
          treeRoot?.getAttribute('data-file-tree-context-menu-trigger-mode') ??
          null,
        rowHasActionLane:
          row.getAttribute('data-item-has-context-menu-action-lane') ?? null,
      };
    }, rowPath);
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
      page.locator('[data-test-menu-action="radix-portaled:src/index.ts"]')
    ).toBeVisible();
  });

  test('always-visible affordances stay decorative while one real trigger handles menus', async ({
    page,
  }) => {
    const snapshot = await readLaneSnapshot(
      page,
      'radix-portaled',
      'src/index.ts'
    );
    expect(snapshot).toMatchObject({
      actionLaneButtonCount: 0,
      actionLaneCount: 1,
      ariaHiddenDecorativeCount: 1,
      decorativeAffordanceCount: 1,
      realTriggerCount: 1,
      rootButtonVisibility: 'always',
      rootHasActionLane: 'true',
      rootTriggerMode: 'both',
      rowHasActionLane: 'true',
    });
  });

  test('right-click-only tree omits the action lane and still opens from right-click', async ({
    page,
  }) => {
    const snapshot = await readLaneSnapshot(
      page,
      'right-click-only',
      'src/index.ts'
    );
    expect(snapshot).toMatchObject({
      actionLaneButtonCount: 0,
      actionLaneCount: 0,
      realTriggerCount: 1,
      rootButtonVisibility: null,
      rootHasActionLane: null,
      rootTriggerMode: 'right-click',
      rowHasActionLane: null,
    });

    const tree = page.locator(
      '[data-demo-context-menu-card="right-click-only"] file-tree-container'
    );
    const row = tree.locator(
      'button[data-type="item"][data-item-path="src/index.ts"]'
    );

    await row.click();
    await row.click({ button: 'right' });

    const menu = page.locator(
      '[data-test-context-menu-variant="right-click-only"]'
    );
    await expect(menu).toBeVisible();
    await expect(
      page.locator('[data-test-menu-action="right-click-only:src/index.ts"]')
    ).toBeVisible();
  });

  test('react client-rendered menu preserves button mode and opens from the trigger button', async ({
    page,
  }) => {
    const snapshot = await readLaneSnapshot(
      page,
      'react-client',
      'src/index.ts'
    );
    expect(snapshot).toMatchObject({
      actionLaneCount: 1,
      rootButtonVisibility: 'always',
      rootHasActionLane: 'true',
      rootTriggerMode: 'button',
      rowHasActionLane: 'true',
    });

    const tree = page.locator(
      '[data-demo-context-menu-card="react-client"] file-tree-container'
    );

    await openMenuFromTrigger(tree, 'src/index.ts');

    const menu = page.locator(
      '[data-test-context-menu-variant="react-client"]'
    );
    await expectMenuWidth(menu, 100);
  });
});
