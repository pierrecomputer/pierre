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

  test('clicking a focused row reveals the when-needed context-menu trigger without hover', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-composition.html');
    await page.waitForFunction(
      () => window.__fileTreeCompositionFixtureReady === true
    );

    const focusedRow = page.locator(
      'file-tree-container button[data-item-path="src/index.ts"]'
    );
    const trigger = page.locator(
      'file-tree-container button[data-type="context-menu-trigger"]'
    );

    await expect(trigger).toHaveAttribute('data-visible', 'false');

    await page.evaluate(() => {
      const host = document.querySelector('file-tree-container');
      const row = host?.shadowRoot?.querySelector(
        'button[data-item-path="src/index.ts"]'
      );
      if (!(row instanceof HTMLButtonElement)) {
        throw new Error('Expected src/index.ts row in file-tree fixture.');
      }

      row.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );
    });

    await expect(focusedRow).toHaveAttribute('data-item-focused', 'true');
    await expect(focusedRow).toHaveAttribute('data-item-selected', 'true');
    await expect(focusedRow).not.toHaveAttribute(
      'data-item-context-hover',
      'true'
    );
    await expect(trigger).toHaveAttribute('data-visible', 'true');
    await expect(trigger).toBeVisible();

    const [rowBox, triggerBox] = await Promise.all([
      focusedRow.boundingBox(),
      trigger.boundingBox(),
    ]);
    if (rowBox == null || triggerBox == null) {
      throw new Error('Expected focused row and context-menu trigger boxes.');
    }

    const triggerCenterY = triggerBox.y + triggerBox.height / 2;
    expect(triggerCenterY).toBeGreaterThanOrEqual(rowBox.y);
    expect(triggerCenterY).toBeLessThanOrEqual(rowBox.y + rowBox.height);
  });

  test('truncated markers match translucent row states and leave focused outlines clear', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-composition.html');
    await page.waitForFunction(
      () => window.__fileTreeCompositionFixtureReady === true
    );

    await page.evaluate(() => {
      const mount = document.querySelector(
        '[data-file-tree-composition-mount]'
      );
      const host = document.querySelector('file-tree-container');
      if (!(mount instanceof HTMLElement) || !(host instanceof HTMLElement)) {
        throw new Error('Expected file-tree composition fixture elements.');
      }

      mount.style.width = '48px';
      host.style.setProperty('--trees-bg-override', 'rgb(240, 240, 240)');
      host.style.setProperty(
        '--trees-bg-muted-override',
        'rgba(0, 0, 0, 0.25)'
      );
      host.style.setProperty('--trees-focus-ring-width-override', '2px');
    });

    const flattenedPath = await page.evaluate(() => {
      const host = document.querySelector('file-tree-container');
      const flattenedRow = Array.from(
        host?.shadowRoot?.querySelectorAll('button[data-type="item"]') ?? []
      ).find(
        (row) => row.querySelector('[data-item-flattened-subitems]') != null
      );

      return flattenedRow instanceof HTMLElement
        ? (flattenedRow.dataset.itemPath ?? null)
        : null;
    });

    if (flattenedPath == null) {
      throw new Error('Expected a flattened row in the composition fixture.');
    }

    const row = page.locator(
      `file-tree-container button[data-item-path="${flattenedPath}"]`
    );
    await row.hover();

    await expect
      .poll(() =>
        page.evaluate((path) => {
          const host = document.querySelector('file-tree-container');
          const rowElement = Array.from(
            host?.shadowRoot?.querySelectorAll('button[data-type="item"]') ?? []
          ).find(
            (candidate) => candidate.getAttribute('data-item-path') === path
          );
          const marker = rowElement?.querySelector('[data-truncate-marker]');
          return marker instanceof HTMLElement
            ? getComputedStyle(marker).opacity
            : null;
        }, flattenedPath)
      )
      .toBe('1');

    const hoverStyles = await page.evaluate((path) => {
      const host = document.querySelector('file-tree-container');
      const rowElement = Array.from(
        host?.shadowRoot?.querySelectorAll('button[data-type="item"]') ?? []
      ).find((candidate) => candidate.getAttribute('data-item-path') === path);
      const marker = rowElement?.querySelector('[data-truncate-marker]');
      if (
        !(rowElement instanceof HTMLElement) ||
        !(marker instanceof HTMLElement)
      ) {
        throw new Error('Expected truncated flattened row marker.');
      }

      const rowStyle = getComputedStyle(rowElement);
      const markerStyle = getComputedStyle(marker);
      return {
        markerBackgroundClip: markerStyle.backgroundClip,
        markerBackgroundColor: markerStyle.backgroundColor,
        markerBackgroundImage: markerStyle.backgroundImage,
        rowBackgroundColor: rowStyle.backgroundColor,
      };
    }, flattenedPath);

    expect(hoverStyles.rowBackgroundColor).toBe('rgba(0, 0, 0, 0.25)');
    expect(hoverStyles.markerBackgroundColor).toBe('rgb(240, 240, 240)');
    expect(hoverStyles.markerBackgroundImage).toContain('rgba(0, 0, 0, 0.25)');
    expect(hoverStyles.markerBackgroundClip).toBe('content-box');

    await row.focus();

    const focusStyles = await page.evaluate((path) => {
      const host = document.querySelector('file-tree-container');
      const rowElement = Array.from(
        host?.shadowRoot?.querySelectorAll('button[data-type="item"]') ?? []
      ).find((candidate) => candidate.getAttribute('data-item-path') === path);
      const marker = rowElement?.querySelector('[data-truncate-marker]');
      if (!(marker instanceof HTMLElement)) {
        throw new Error('Expected focused flattened row marker.');
      }

      const markerStyle = getComputedStyle(marker);
      const markerBeforeStyle = getComputedStyle(marker, '::before');
      return {
        markerHeight: Number.parseFloat(markerStyle.height),
        markerPaddingBottom: Number.parseFloat(markerStyle.paddingBottom),
        markerPaddingTop: Number.parseFloat(markerStyle.paddingTop),
        markerBeforeHeight: Number.parseFloat(markerBeforeStyle.height),
        markerBeforeTop: Number.parseFloat(markerBeforeStyle.top),
      };
    }, flattenedPath);

    expect(focusStyles.markerPaddingTop).toBe(2);
    expect(focusStyles.markerPaddingBottom).toBe(2);
    expect(focusStyles.markerBeforeTop).toBe(2);
    expect(focusStyles.markerBeforeHeight).toBe(focusStyles.markerHeight - 4);

    await page
      .locator('file-tree-container button[data-item-path="README.md"]')
      .focus();

    const fileMarkerPadding = await page.evaluate(() => {
      const host = document.querySelector('file-tree-container');
      const marker = host?.shadowRoot?.querySelector(
        'button[data-item-path="README.md"] [data-truncate-marker]'
      );
      if (!(marker instanceof HTMLElement)) {
        throw new Error('Expected focused README.md row marker.');
      }

      const markerStyle = getComputedStyle(marker);
      return {
        bottom: Number.parseFloat(markerStyle.paddingBottom),
        top: Number.parseFloat(markerStyle.paddingTop),
      };
    });

    expect(fileMarkerPadding.top).toBe(0);
    expect(fileMarkerPadding.bottom).toBe(0);
  });

  test('keyboard navigation retargets the focused row trigger away from a stale hover', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/file-tree-composition.html');
    await page.waitForFunction(
      () => window.__fileTreeCompositionFixtureReady === true
    );

    const sourceFocusRow = page.locator(
      'file-tree-container button[data-item-path="src/"]'
    );
    const focusedRow = page.locator(
      'file-tree-container button[data-item-path="src/lib/"]'
    );
    const hoveredRow = page.locator(
      'file-tree-container button[data-item-path="src/lib/utils.ts"]'
    );
    const trigger = page.locator(
      'file-tree-container button[data-type="context-menu-trigger"]'
    );

    await hoveredRow.hover();
    await expect(hoveredRow).toHaveAttribute('data-item-context-hover', 'true');

    await sourceFocusRow.focus();
    await expect(sourceFocusRow).toHaveAttribute('data-item-focused', 'true');

    await page.keyboard.press('ArrowDown');

    await expect(focusedRow).toHaveAttribute('data-item-focused', 'true');
    await expect(hoveredRow).toHaveAttribute('data-item-context-hover', 'true');
    await expect(trigger).toHaveAttribute('data-visible', 'true');

    await trigger.click();
    await expect(page.locator('[data-test-context-menu]')).toBeVisible();
    await expect(
      page.locator('[data-test-file-tree-menu="src/lib/"]')
    ).toHaveCount(1);
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
