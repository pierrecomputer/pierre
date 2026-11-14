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

  test('truncated names use native text overflow without legacy marker layers', async ({
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
      if (!(mount instanceof HTMLElement)) {
        throw new Error('Expected file-tree composition fixture mount.');
      }

      mount.style.width = '48px';
    });

    const row = page.locator(
      'file-tree-container button[data-item-path="README.md"]'
    );
    await expect(row).toBeVisible();

    const truncation = await page.evaluate(() => {
      const host = document.querySelector('file-tree-container');
      const rowElement = host?.shadowRoot?.querySelector(
        'button[data-item-path="README.md"]'
      );
      const group = rowElement?.querySelector(
        '[data-truncate-group-container="middle"]'
      );
      if (
        !(rowElement instanceof HTMLElement) ||
        !(group instanceof HTMLElement)
      ) {
        throw new Error('Expected README.md row middle truncation group.');
      }

      const directContainers = Array.from(group.children).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          child.hasAttribute('data-truncate-container')
      );
      const shrinkingContainers = directContainers.filter(
        (container) =>
          container.getAttribute('data-truncate-segment-priority') === '2'
      );

      return {
        groupText: group.textContent,
        directContainerCount: directContainers.length,
        directChildCount: group.children.length,
        legacyLayerCount: rowElement.querySelectorAll(
          '[data-truncate-marker], [data-truncate-grid], [data-truncate-fill]'
        ).length,
        segments: directContainers.map((container) => {
          const style = getComputedStyle(container);
          return {
            mode: container.getAttribute('data-truncate-container'),
            priority: container.getAttribute('data-truncate-segment-priority'),
            text: container.textContent,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace,
          };
        }),
        shrinkingSegmentStyles: shrinkingContainers.map((container) => {
          const style = getComputedStyle(container);
          return {
            overflowX: style.overflowX,
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace,
          };
        }),
      };
    });

    expect(truncation.directContainerCount).toBe(2);
    expect(truncation.directChildCount).toBe(2);
    expect(truncation.groupText).toBe('README.md');
    expect(truncation.legacyLayerCount).toBe(0);
    expect(truncation.segments).toEqual([
      {
        mode: 'truncate',
        overflowX: 'hidden',
        overflowY: 'hidden',
        priority: '2',
        text: 'README.',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      {
        mode: 'fruncate',
        overflowX: 'hidden',
        overflowY: 'hidden',
        priority: '1',
        text: 'md',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
    ]);
    expect(truncation.shrinkingSegmentStyles).toEqual([
      {
        overflowX: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
    ]);
  });

  test('keeps middle-truncated README segments separated at the ellipsis boundary', async ({
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
      if (!(mount instanceof HTMLElement)) {
        throw new Error('Expected file-tree composition fixture mount.');
      }

      mount.style.width = '42px';
    });

    const row = page.locator(
      'file-tree-container button[data-item-path="README.md"]'
    );
    await expect(row).toBeVisible();

    const layout = await page.evaluate(() => {
      const host = document.querySelector('file-tree-container');
      const rowElement = host?.shadowRoot?.querySelector(
        'button[data-item-path="README.md"]'
      );
      const group = rowElement?.querySelector(
        '[data-truncate-group-container="middle"]'
      );
      if (
        !(rowElement instanceof HTMLElement) ||
        !(group instanceof HTMLElement)
      ) {
        throw new Error('Expected README.md row middle truncation group.');
      }

      const directContainers = Array.from(group.children).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          child.hasAttribute('data-truncate-container')
      );
      const [firstSegment, secondSegment] = directContainers;
      if (
        directContainers.length !== 2 ||
        !(firstSegment instanceof HTMLElement) ||
        !(secondSegment instanceof HTMLElement)
      ) {
        throw new Error(
          'Expected README.md middle truncation to split in two.'
        );
      }

      const firstRect = firstSegment.getBoundingClientRect();
      const secondRect = secondSegment.getBoundingClientRect();
      const firstStyle = getComputedStyle(firstSegment);
      const fontSize = Number.parseFloat(firstStyle.fontSize);
      const ellipsisVisibleWidth = Math.max(6, fontSize * 0.5);

      return {
        ellipsisVisibleWidth,
        firstRight: firstRect.right,
        firstText: firstSegment.textContent,
        firstWidth: firstRect.width,
        secondLeft: secondRect.left,
        secondText: secondSegment.textContent,
      };
    });

    expect(layout.firstText).toBe('README.');
    expect(layout.secondText).toBe('md');
    expect(layout.firstWidth).toBeGreaterThanOrEqual(
      layout.ellipsisVisibleWidth
    );
    expect(layout.secondLeft).toBeGreaterThanOrEqual(layout.firstRight - 0.5);
  });

  test('flattened and short rows use native truncation styles', async ({
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
      if (!(mount instanceof HTMLElement)) {
        throw new Error('Expected file-tree composition fixture mount.');
      }

      mount.style.width = '48px';
    });

    const truncation = await page.evaluate(() => {
      const readNativeTruncationStyle = (container: HTMLElement) => {
        const style = getComputedStyle(container);
        return {
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace,
        };
      };

      const host = document.querySelector('file-tree-container');
      const shadowRoot = host?.shadowRoot;
      const flattenedSubitems = shadowRoot?.querySelector(
        '[data-item-flattened-subitems]'
      );
      const flattenedRow = flattenedSubitems?.closest(
        'button[data-type="item"]'
      );

      if (
        !(flattenedSubitems instanceof HTMLElement) ||
        !(flattenedRow instanceof HTMLElement)
      ) {
        throw new Error('Expected row containing flattened subitems.');
      }

      const flattenedSegmentContainers = Array.from(
        flattenedSubitems.querySelectorAll<HTMLElement>(
          '[data-item-flattened-subitem] > [data-truncate-container]'
        )
      );

      const shortRow = shadowRoot?.querySelector(
        'button[data-item-path="src/"]'
      );
      if (!(shortRow instanceof HTMLElement)) {
        throw new Error('Expected src/ row in file-tree fixture.');
      }

      const shortRowContainers = Array.from(
        shortRow.querySelectorAll<HTMLElement>(
          '[data-item-section="content"] [data-truncate-container]'
        )
      );

      return {
        flattenedLegacyLayerCount: flattenedRow.querySelectorAll(
          '[data-truncate-marker], [data-truncate-grid], [data-truncate-fill]'
        ).length,
        flattenedSegmentCount: flattenedSubitems.querySelectorAll(
          '[data-item-flattened-subitem]'
        ).length,
        flattenedSegmentStyles: flattenedSegmentContainers.map((container) => ({
          mode: container.getAttribute('data-truncate-container'),
          ...readNativeTruncationStyle(container),
        })),
        shortRowLegacyLayerCount: shortRow.querySelectorAll(
          '[data-truncate-marker], [data-truncate-grid], [data-truncate-fill]'
        ).length,
        shortRowSegments: shortRowContainers.map((container) => {
          const style = getComputedStyle(container);
          return {
            mode: container.getAttribute('data-truncate-container'),
            text: container.textContent,
            textAlign: style.textAlign,
            ...readNativeTruncationStyle(container),
          };
        }),
      };
    });

    expect(truncation.flattenedSegmentCount).toBeGreaterThan(1);
    expect(truncation.flattenedLegacyLayerCount).toBe(0);
    expect(truncation.flattenedSegmentStyles).toHaveLength(
      truncation.flattenedSegmentCount
    );
    for (const segmentStyle of truncation.flattenedSegmentStyles) {
      expect(segmentStyle).toEqual({
        mode: 'truncate',
        overflowX: 'hidden',
        overflowY: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      });
    }

    expect(truncation.shortRowLegacyLayerCount).toBe(0);
    expect(truncation.shortRowSegments).toEqual([
      {
        mode: 'fruncate',
        overflowX: 'hidden',
        overflowY: 'hidden',
        text: 'src',
        textAlign: 'end',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
    ]);
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
