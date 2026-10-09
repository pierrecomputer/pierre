import { expect, type Page, test } from '@playwright/test';

async function expectAlignedRows(page: Page): Promise<void> {
  const columns = await page.locator('[data-code]').evaluateAll((nodes) =>
    nodes.map((code) => {
      const gutter = code.querySelector('[data-gutter]');
      const content = code.querySelector('[data-content]');
      if (gutter == null || content == null) {
        throw new Error('Missing gutter or content column');
      }
      const rows = [...code.querySelectorAll('[data-line]')];
      const aligned = rows.every((row) => {
        const number = gutter.querySelector(
          `[data-line-index="${row.getAttribute('data-line-index')}"]`
        );
        if (number == null) return false;
        const left = number.getBoundingClientRect();
        const right = row.getBoundingClientRect();
        return (
          Math.abs(left.top - right.top) < 0.5 &&
          Math.abs(left.height - right.height) < 0.5
        );
      });
      return {
        rows: rows.length,
        aligned,
        height: content.getBoundingClientRect().height,
        gutterHeight: gutter.getBoundingClientRect().height,
      };
    })
  );
  expect(columns.length).toBeGreaterThan(0);
  for (const column of columns) {
    expect(column.rows).toBeGreaterThan(0);
    expect(column.aligned).toBe(true);
    expect(column.gutterHeight).toBeCloseTo(column.height, 0);
  }
  if (columns.length === 2) {
    expect(columns[0].height).toBeCloseTo(columns[1].height, 0);
  }
}

for (const type of ['file', 'split', 'unified']) {
  for (const params of ['', '&hideNumbers', '&partial']) {
    test(`${type} rows align with gutters and buffers ${params}`, async ({
      page,
    }) => {
      await page.goto(
        `/test/e2e/fixtures/row-layout.html?type=${type}${params}`
      );
      await expect(page.locator('[data-code]').first()).toHaveCSS(
        'display',
        'flex'
      );
      await expectAlignedRows(page);

      const scroller = page.locator('[data-code]').first();
      const number = scroller.locator('[data-gutter]');
      const before = await number.evaluate(
        (node) => node.getBoundingClientRect().x
      );
      await scroller.evaluate((node) => {
        node.scrollLeft = 200;
      });
      expect(
        await number.evaluate((node) => node.getBoundingClientRect().x)
      ).toBe(before);
      await expectAlignedRows(page);
    });
  }

  test(`${type} restores grid for annotations and wrapping`, async ({
    page,
  }) => {
    await page.goto(`/test/e2e/fixtures/row-layout.html?type=${type}`);
    const code = page.locator('[data-code]').first();
    await expect(code).toHaveCSS('display', 'flex');
    await page.locator('[data-annotation]').click();
    await expect(code).toHaveCSS('display', 'grid');
    await expectAlignedRows(page);
    await page.locator('[data-clear]').click();
    await expect(code).toHaveCSS('display', 'flex');
    await expectAlignedRows(page);
    await page.locator('[data-wrap]').click();
    await expect(code).toHaveCSS(
      'display',
      type === 'split' ? 'contents' : 'grid'
    );
    await expectAlignedRows(page);
    await page.locator('[data-scroll]').click();
    await expect(code).toHaveCSS('display', 'flex');
    await expectAlignedRows(page);
  });

  test(`${type} restores grid when editing starts`, async ({ page }) => {
    await page.goto(`/test/e2e/fixtures/row-layout.html?type=${type}`);
    const code = page.locator('[data-code]').first();
    await expect(code).toHaveCSS('display', 'flex');
    await page.locator('[data-edit]').click();
    await expect(page.locator('[contenteditable="true"]')).toBeVisible();
    await expect(code).toHaveCSS('display', 'grid');
    await expectAlignedRows(page);
  });

  test(`${type} keeps custom row heights aligned`, async ({ page }) => {
    await page.goto(`/test/e2e/fixtures/row-layout.html?type=${type}`);
    const code = page.locator('[data-code]').first();
    await expect(code).toHaveCSS('display', 'flex');
    await page.locator('[data-custom-css]').click();
    await expect(code).toHaveCSS('display', 'grid');
    await expectAlignedRows(page);
    await page.locator('[data-clear-css]').click();
    await expect(code).toHaveCSS('display', 'flex');
    await expectAlignedRows(page);
  });
}

test('unified diff preserves shared final metadata row height', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/row-layout.html?type=unified&noNewline');
  await expect(page.locator('[data-code]')).toHaveCSS('display', 'flex');
  await expect(page.locator('[data-no-newline]')).toHaveCount(1);
  await expectAlignedRows(page);
});

test('expanded split diff supports gutter selection and collapsed context', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/row-layout.html?type=split');
  const code = page.locator('[data-code][data-additions]');
  await expect(code).toHaveCSS('display', 'flex');
  await code.locator('[data-column-number="5"]').click();
  await expect(code.locator('[data-line="5"][data-selected-line]')).toHaveCount(
    1
  );
  await page.locator('[data-collapse]').click();
  await expect(code).toHaveCSS('display', 'grid');
  await expect(page.locator('[data-expand-button]').first()).toBeVisible();
  await expectAlignedRows(page);
});
