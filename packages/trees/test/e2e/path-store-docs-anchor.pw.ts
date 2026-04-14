import { expect, test } from '@playwright/test';

const PATH_STORE_DOCS_BASE_URL =
  process.env.PATH_STORE_DOCS_BASE_URL ?? 'http://127.0.0.1:3103';

test.describe('path-store docs route', () => {
  test.skip(
    process.env.PATH_STORE_DOCS_E2E !== '1',
    'Manual docs-route verification; requires a running docs server.'
  );

  test('moves the floating trigger when the active row changes in the docs demo', async ({
    page,
  }) => {
    await page.goto(`${PATH_STORE_DOCS_BASE_URL}/trees-dev/path-store-powered`);

    const nextFrame = async () => {
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
          })
      );
    };

    const getTriggerMeasurement = async (
      path: string
    ): Promise<{
      anchoredPath: string | null;
      rowTop: number;
      triggerTop: number;
      visible: string | null;
    } | null> =>
      page.evaluate((nextPath) => {
        const host = document.querySelector('file-tree-container');
        const shadowRoot = host?.shadowRoot;
        const row = shadowRoot?.querySelector(
          `button[data-item-path="${nextPath}"]`
        );
        if (!(row instanceof HTMLElement)) {
          return null;
        }

        const trigger = shadowRoot?.querySelector(
          'button[data-type="context-menu-trigger"]'
        );
        const anchoredRow = shadowRoot?.querySelector(
          'button[data-item-context-anchor="true"]'
        );
        if (!(trigger instanceof HTMLElement)) {
          return null;
        }

        const triggerRect = trigger.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        return {
          anchoredPath:
            anchoredRow instanceof HTMLElement
              ? (anchoredRow.dataset.itemPath ?? null)
              : null,
          rowTop: rowRect.top,
          triggerTop: triggerRect.top,
          visible: trigger.dataset.visible ?? null,
        };
      }, path);

    await expect(
      page.locator('file-tree-container button[data-item-path="arch/"]')
    ).toBeVisible();

    const firstRow = page.locator(
      'file-tree-container button[data-item-path="arch/"]'
    );
    await firstRow.hover();
    await nextFrame();
    await nextFrame();
    const firstMeasurement = await getTriggerMeasurement('arch/');
    expect(firstMeasurement).not.toBeNull();
    expect(firstMeasurement?.visible).toBe('true');
    expect(firstMeasurement?.anchoredPath).toBe('arch/');

    const secondRow = page.locator(
      'file-tree-container button[data-item-path="arch/alpha/boot/"]'
    );
    await secondRow.hover();
    await nextFrame();
    await nextFrame();
    const secondMeasurement = await getTriggerMeasurement('arch/alpha/boot/');
    expect(secondMeasurement).not.toBeNull();
    expect(secondMeasurement?.visible).toBe('true');
    expect(secondMeasurement?.anchoredPath).toBe('arch/alpha/boot/');
    expect(secondMeasurement?.triggerTop).toBeGreaterThan(
      (firstMeasurement?.triggerTop ?? 0) + 20
    );
  });
});
