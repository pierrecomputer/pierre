import { expect, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    __fileTreeCompositionFixtureReady?: boolean;
  }
}

async function pressFocusedRowKey(page: Page, key: string): Promise<void> {
  await page.evaluate((nextKey) => {
    const host = document.querySelector('file-tree-container');
    const shadowRoot = host?.shadowRoot;
    const focusedItem =
      (shadowRoot?.activeElement as HTMLButtonElement | null) ??
      (shadowRoot?.querySelector(
        'button[data-type="item"][data-item-focused="true"]'
      ) as HTMLButtonElement | null);

    if (!(focusedItem instanceof HTMLButtonElement)) {
      throw new Error(
        `Expected focused file-tree row before pressing ${nextKey}`
      );
    }

    focusedItem.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: nextKey,
      })
    );
  }, key);
}

test.describe('file-tree composition surfaces', () => {
  test('hovering a scrolled tree does not change the visible slice or scroll position', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-composition.html');
    await page.waitForFunction(
      () => window.__fileTreeCompositionFixtureReady === true
    );

    const measurement = await page.evaluate(async () => {
      const host = document.querySelector('file-tree-container');
      const shadowRoot = host?.shadowRoot;
      const scroll = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scroll instanceof HTMLElement)) {
        return null;
      }

      const nextFrame = () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });

      const pickPaths = [
        'src/lib/theme.ts',
        'src/lib/utils.ts',
        'src/index.ts',
        'README.md',
      ];
      const measure = () => ({
        rows: pickPaths.map((path) => {
          const row = shadowRoot?.querySelector(
            `button[data-item-path="${path}"]`
          );
          return row instanceof HTMLElement
            ? {
                path,
                top: row.getBoundingClientRect().top,
              }
            : {
                path,
                top: null,
              };
        }),
        scrollTop: scroll.scrollTop,
      });

      scroll.scrollTop = 60;
      await nextFrame();
      await nextFrame();

      const before = measure();
      const hoverRow = shadowRoot?.querySelector(
        'button[data-item-path="src/index.ts"]'
      );
      if (!(hoverRow instanceof HTMLElement)) {
        return { before, after: null };
      }

      hoverRow.dispatchEvent(
        new PointerEvent('pointerover', { bubbles: true, composed: true })
      );
      await nextFrame();
      await nextFrame();

      return {
        after: measure(),
        before,
      };
    });

    expect(measurement).not.toBeNull();
    expect(measurement?.after).not.toBeNull();
    expect(measurement?.after?.scrollTop).toBe(measurement?.before.scrollTop);
    expect(measurement?.after?.rows).toEqual(measurement?.before.rows);
  });

  test('moves the floating trigger when the active row changes', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-composition.html');
    await page.waitForFunction(
      () => window.__fileTreeCompositionFixtureReady === true
    );

    const firstRow = page.locator(
      'file-tree-container button[data-item-path="src/lib/theme.ts"]'
    );
    const secondRow = page.locator(
      'file-tree-container button[data-item-path="README.md"]'
    );
    const trigger = page.locator(
      'file-tree-container button[data-type="context-menu-trigger"][data-visible="true"]'
    );

    await firstRow.hover();
    const firstBox = await trigger.boundingBox();
    expect(firstBox).not.toBeNull();

    await secondRow.hover();
    const secondBox = await trigger.boundingBox();
    expect(secondBox).not.toBeNull();

    expect(secondBox?.y).toBeGreaterThan((firstBox?.y ?? 0) + 20);
  });

  test('keeps the context-menu shell slotted in light DOM while anchoring from the shadow tree', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-composition.html');
    await page.waitForFunction(
      () => window.__fileTreeCompositionFixtureReady === true
    );

    await expect(
      page.locator('file-tree-container [slot="header"]')
    ).toHaveText('File tree header');

    const secondRow = page.locator(
      'file-tree-container button[data-item-path="src/index.ts"]'
    );
    await secondRow.click();
    await secondRow.click({ button: 'right' });

    await expect(page.locator('[data-test-file-tree-menu]')).toBeVisible();

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

    await page.locator('[data-test-file-tree-menu-close]').click();
    await expect(page.locator('[data-test-file-tree-menu]')).toHaveCount(0);
  });

  test('restores keyboard navigation after closing a mouse-opened context menu', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-composition.html');
    await page.waitForFunction(
      () => window.__fileTreeCompositionFixtureReady === true
    );

    const getFocusedPath = async (): Promise<string | null> =>
      page.evaluate(() => {
        const host = document.querySelector('file-tree-container');
        const focusedItem = host?.shadowRoot?.querySelector(
          'button[data-type="item"][data-item-focused="true"]'
        ) as HTMLButtonElement | null;
        return focusedItem?.dataset.itemPath ?? null;
      });

    const focusedRow = page.locator(
      'file-tree-container button[data-item-path="src/index.ts"]'
    );
    await expect(focusedRow).toBeVisible();
    await focusedRow.click();
    await focusedRow.focus();

    const focusedBeforeOpen = await getFocusedPath();
    if (focusedBeforeOpen == null) {
      throw new Error('Expected focused path before opening context menu');
    }

    await focusedRow.hover();

    const trigger = page.locator(
      'file-tree-container button[data-type="context-menu-trigger"][data-visible="true"]'
    );
    await expect(trigger).toBeVisible();
    await trigger.click();

    const menu = page.locator('[data-test-context-menu]');
    await expect(menu).toBeVisible();
    await expect(page.locator('[data-test-menu-delete]')).toBeFocused();

    await pressFocusedRowKey(page, 'ArrowDown');
    await expect.poll(getFocusedPath).toBe(focusedBeforeOpen);

    await page.locator('[data-test-menu-delete]').click();
    await expect(menu).toHaveCount(0);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const host = document.querySelector('file-tree-container');
          const shadowRoot = host?.shadowRoot;
          return (
            shadowRoot?.activeElement instanceof HTMLElement &&
            shadowRoot.activeElement !== shadowRoot.host
          );
        })
      )
      .toBe(true);

    await pressFocusedRowKey(page, 'ArrowDown');
    await expect.poll(getFocusedPath).not.toBe(focusedBeforeOpen);
  });
});
