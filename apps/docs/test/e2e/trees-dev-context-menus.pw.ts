import { expect, test } from '@playwright/test';

async function openMenuFromTrigger(
  page: import('@playwright/test').Page,
  tree: import('@playwright/test').Locator,
  rowPath: string
): Promise<void> {
  const row = tree.locator(
    `button[data-type="item"][data-item-path="${rowPath}"]`
  );
  await row.click();
  const box = await row.boundingBox();
  if (box != null) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  }
  await row.hover();
  const trigger = tree.locator(
    'button[data-type="context-menu-trigger"][data-visible="true"]'
  );
  await expect(trigger).toBeVisible();
  await trigger.click();
}

async function readMainMenuGeometry(
  page: import('@playwright/test').Page
): Promise<{
  anchorLeft: number;
  anchorTop: number;
  menuLeft: number;
  menuTop: number;
  triggerBottom: number;
  triggerLeft: number;
} | null> {
  return page.evaluate(() => {
    const host = document.querySelector('file-tree-container');
    const shadowRoot = host?.shadowRoot;
    const anchor = shadowRoot?.querySelector(
      '[data-type="context-menu-anchor"]'
    );
    const trigger = shadowRoot?.querySelector(
      'button[data-type="context-menu-trigger"]'
    );
    const menu = document.querySelector('[data-test-context-menu="true"]');
    if (
      !(anchor instanceof HTMLElement) ||
      !(trigger instanceof HTMLElement) ||
      !(menu instanceof HTMLElement)
    ) {
      return null;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    return {
      anchorLeft: anchorRect.left,
      anchorTop: anchorRect.top,
      menuLeft: menuRect.left,
      menuTop: menuRect.top,
      triggerBottom: triggerRect.bottom,
      triggerLeft: triggerRect.left,
    };
  });
}

async function expectMainMenuTopLeftAlignedToTrigger(
  page: import('@playwright/test').Page
): Promise<void> {
  await expect
    .poll(async () => {
      const geometry = await readMainMenuGeometry(page);
      return geometry == null
        ? Number.POSITIVE_INFINITY
        : Math.abs(geometry.menuLeft - geometry.triggerLeft);
    })
    .toBeLessThanOrEqual(4);
  await expect
    .poll(async () => {
      const geometry = await readMainMenuGeometry(page);
      return geometry == null
        ? Number.POSITIVE_INFINITY
        : Math.abs(geometry.menuTop - (geometry.triggerBottom + 4));
    })
    .toBeLessThanOrEqual(4);
}

async function expectMainMenuTopLeftAlignedToPointerAnchor(
  page: import('@playwright/test').Page
): Promise<void> {
  await expect
    .poll(async () => {
      const geometry = await readMainMenuGeometry(page);
      return geometry == null
        ? Number.POSITIVE_INFINITY
        : Math.abs(geometry.menuLeft - geometry.anchorLeft);
    })
    .toBeLessThanOrEqual(4);
  await expect
    .poll(async () => {
      const geometry = await readMainMenuGeometry(page);
      return geometry == null
        ? Number.POSITIVE_INFINITY
        : Math.abs(geometry.menuTop - geometry.anchorTop);
    })
    .toBeLessThanOrEqual(4);
}

async function readReactMenuGeometry(
  page: import('@playwright/test').Page
): Promise<{
  bottom: number;
  left: number;
  right: number;
  top: number;
  viewportHeight: number;
  viewportWidth: number;
  width: number;
} | null> {
  return page.evaluate(() => {
    const slottedMenu = document
      .querySelectorAll('file-tree-container')[1]
      ?.querySelector('[slot="context-menu"] > div');
    const portaledMenu = document.querySelector(
      '[data-test-react-context-menu="true"]'
    );
    const menu =
      portaledMenu instanceof HTMLElement
        ? portaledMenu
        : slottedMenu instanceof HTMLElement
          ? slottedMenu
          : null;
    if (menu == null) {
      return null;
    }

    const rect = menu.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      width: rect.width,
    };
  });
}

async function expectReactMenuVisibleInViewport(
  page: import('@playwright/test').Page
): Promise<void> {
  await expect
    .poll(() => readReactMenuGeometry(page))
    .toEqual(
      expect.objectContaining({
        bottom: expect.any(Number),
        left: expect.any(Number),
        right: expect.any(Number),
        top: expect.any(Number),
        viewportHeight: expect.any(Number),
        viewportWidth: expect.any(Number),
        width: expect.any(Number),
      })
    );

  const geometry = await readReactMenuGeometry(page);
  expect(geometry).not.toBeNull();
  expect(geometry!.width).toBeGreaterThan(100);
  expect(geometry!.left).toBeGreaterThanOrEqual(0);
  expect(geometry!.right).toBeLessThanOrEqual(geometry!.viewportWidth);
  expect(geometry!.top).toBeGreaterThanOrEqual(0);
  expect(geometry!.bottom).toBeLessThanOrEqual(geometry!.viewportHeight);
}
async function expectContextMenuTriggerOpacity(
  page: import('@playwright/test').Page,
  treeIndex: number,
  expectedOpacity: string
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        ({ expectedTreeIndex }) => {
          const host = document.querySelectorAll('file-tree-container')[
            expectedTreeIndex
          ];
          const trigger = host?.shadowRoot?.querySelector(
            'button[data-type="context-menu-trigger"]'
          );
          return trigger instanceof HTMLElement
            ? getComputedStyle(trigger).opacity
            : null;
        },
        { expectedTreeIndex: treeIndex }
      )
    )
    .toBe(expectedOpacity);
}

async function expectContextMenuTriggerExpanded(
  page: import('@playwright/test').Page,
  treeIndex: number,
  expectedExpanded: string
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        ({ expectedTreeIndex }) => {
          const host = document.querySelectorAll('file-tree-container')[
            expectedTreeIndex
          ];
          const trigger = host?.shadowRoot?.querySelector(
            'button[data-type="context-menu-trigger"]'
          );
          return trigger instanceof HTMLElement
            ? trigger.getAttribute('aria-expanded')
            : null;
        },
        { expectedTreeIndex: treeIndex }
      )
    )
    .toBe(expectedExpanded);
}

test.describe('trees-dev real page context menus', () => {
  test('main demo trigger-opened menu aligns top-left below the trigger bottom-left', async ({
    page,
  }) => {
    await page.goto('/trees-dev');

    const tree = page.locator('file-tree-container').first();
    await openMenuFromTrigger(page, tree, 'arch/alpha/boot/bootp.c');

    await expect(page.locator('[data-test-context-menu="true"]')).toBeVisible();
    await expectContextMenuTriggerExpanded(page, 0, 'true');
    await expectMainMenuTopLeftAlignedToTrigger(page);
  });

  test('main demo right-click menu aligns top-left to the pointer anchor', async ({
    page,
  }) => {
    await page.goto('/trees-dev');

    const tree = page.locator('file-tree-container').first();
    const row = tree.locator(
      'button[data-type="item"][data-item-path="arch/alpha/boot/bootp.c"]'
    );
    await row.click();
    await row.hover();
    await row.click({ button: 'right' });

    await expectContextMenuTriggerExpanded(page, 0, 'true');
    await expectContextMenuTriggerOpacity(page, 0, '0');
    await expect(page.locator('[data-test-context-menu="true"]')).toHaveCount(
      1
    );
    await expectMainMenuTopLeftAlignedToPointerAnchor(page);
  });

  test('navigating to the React demo with an open main menu does not log a root unmount warning', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const handleConsole = (
      message: import('@playwright/test').ConsoleMessage
    ) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    };
    page.on('console', handleConsole);

    try {
      await page.goto('/trees-dev');

      const tree = page.locator('file-tree-container').first();
      await openMenuFromTrigger(page, tree, 'arch/alpha/boot/bootp.c');
      await expect(
        page.locator('[data-test-context-menu="true"]')
      ).toBeVisible();

      await page
        .locator('nav')
        .getByRole('link', { name: 'React', exact: true })
        .first()
        .click();
      await expect(page).toHaveURL(/\/trees-dev\/react$/);
      await expect(
        page.getByRole('heading', { level: 1, name: 'React' })
      ).toBeVisible();

      expect(
        consoleErrors.filter((message) =>
          message.includes('Attempted to synchronously unmount a root')
        )
      ).toEqual([]);
    } finally {
      page.off('console', handleConsole);
    }
  });

  test('react client demo defaults to right-click without a visible trigger button', async ({
    page,
  }) => {
    await page.goto('/trees-dev/react');

    const tree = page.locator('file-tree-container').nth(1);
    await expect(
      tree.locator(
        'button[data-type="context-menu-trigger"][data-visible="true"]'
      )
    ).toHaveCount(0);
    await expect
      .poll(() =>
        tree.evaluate((host) => {
          const treeRoot = host.shadowRoot?.querySelector('[role="tree"]');
          return treeRoot?.getAttribute(
            'data-file-tree-context-menu-trigger-mode'
          );
        })
      )
      .toBe('right-click');
  });

  test('react client demo right-click menu has a visible surface', async ({
    page,
  }) => {
    await page.goto('/trees-dev/react');

    const tree = page.locator('file-tree-container').nth(1);
    const row = tree.locator(
      'button[data-type="item"][data-item-path="src/index.ts"]'
    );
    await row.click();
    await row.hover();
    await row.click({ button: 'right' });

    await expectReactMenuVisibleInViewport(page);
  });
});
