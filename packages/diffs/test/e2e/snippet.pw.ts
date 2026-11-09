import { expect, type Page, test } from '@playwright/test';

// Space between the code column's edges and its first/last line row.
async function edgeGaps(page: Page, mount: string) {
  return page
    .locator(`[data-mount="${mount}"] [data-code]`)
    .evaluateAll((codes) =>
      codes.map((code) => {
        const box = code.getBoundingClientRect();
        const rows = [...code.querySelectorAll('[data-content] [data-line]')];
        const first = rows[0].getBoundingClientRect();
        const last = rows[rows.length - 1].getBoundingClientRect();
        return {
          top: Math.round(first.top - box.top),
          bottom: Math.round(box.bottom - last.bottom),
        };
      })
    );
}

for (const type of ['unified', 'split', 'file']) {
  test(`${type}: hidden boundary separators leave no gap`, async ({ page }) => {
    await page.goto(`/test/e2e/fixtures/snippet.html?type=${type}&hide`);
    const snippet = page.locator('[data-mount="snippet"] [data-code]').first();
    await expect(snippet.locator('[data-line]').first()).toBeVisible();
    await expect(
      page.locator('[data-mount="snippet"] [data-snippet-boundary]').first()
    ).toBeHidden();
    // A snippet whose edge folds are hidden sits in its frame exactly like a
    // full render of the same file.
    expect(await edgeGaps(page, 'snippet')).toEqual(
      await edgeGaps(page, 'full')
    );
  });

  test(`${type}: built-in boundary separators open on click`, async ({
    page,
  }) => {
    await page.goto(`/test/e2e/fixtures/snippet.html?type=${type}`);
    const mount = page.locator('[data-mount="snippet"]');
    const label = mount
      .locator(
        '[data-gutter] [data-snippet-boundary="below"] [data-unmodified-lines]'
      )
      .first();
    await expect(label).toBeVisible();
    await label.click();
    await expect(mount.locator('[data-snippet-boundary="below"]')).toHaveCount(
      0
    );
    await expect(
      mount.locator('[data-content] [data-line="60"]').first()
    ).toBeVisible();
  });
}

for (const type of ['unified', 'split']) {
  test(`${type}: a boundary fold hiding changes shows tinted -D / +A pills`, async ({
    page,
  }) => {
    await page.goto(`/test/e2e/fixtures/snippet.html?type=${type}`);
    const above = page
      .locator(
        '[data-mount="snippet"] [data-gutter] [data-snippet-boundary="above"]'
      )
      .first();
    const label = above.locator('[data-unmodified-lines]');
    const pills = above.locator('[data-snippet-change-counts] > *');
    await expect(label).toHaveText('25 lines, includes changes');
    await expect(pills).toHaveText(['-1', '+1']);
    await expect(above.locator('[data-snippet-change-counts]')).toHaveAttribute(
      'aria-label',
      '1 removed, 1 added'
    );
    const styles = await pills.evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          color: style.color,
          background: style.backgroundColor,
          weight: Number(style.fontWeight),
          radius: parseFloat(style.borderTopLeftRadius),
          top: Math.round(node.getBoundingClientRect().top),
        };
      })
    );
    const labelBox = await label.boundingBox();
    // Two differently tinted, bold, rounded pills on the label's row.
    expect(styles[0].color).not.toBe(styles[1].color);
    expect(styles[0].background).not.toBe(styles[1].background);
    for (const pill of styles) {
      expect(pill.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(pill.weight).toBeGreaterThanOrEqual(600);
      expect(pill.radius).toBeGreaterThan(4);
      expect(Math.abs(pill.top - labelBox!.y)).toBeLessThan(labelBox!.height);
    }
    // The fold below hides no change: no pills.
    await expect(
      page
        .locator(
          '[data-mount="snippet"] [data-gutter] [data-snippet-boundary="below"] [data-snippet-change-counts]'
        )
        .first()
    ).toHaveCount(0);
    // A click on a pill opens the fold like a click on the label.
    await pills.last().click();
    await expect(
      page
        .locator('[data-mount="snippet"] [data-content] [data-line="20"]')
        .first()
    ).toBeVisible();
  });
}

// WCAG contrast of each pill's text on its tint, the tint composited over
// whatever the separator draws beneath it. Colors are resolved by painting
// them on a canvas, so lab() and color-mix() results read back as sRGB.
async function pillContrast(page: Page) {
  return page
    .locator(
      '[data-mount="snippet"] [data-gutter] [data-snippet-boundary="above"] [data-snippet-change-counts] > *'
    )
    .evaluateAll((pills) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const paint = (layers: string[]) => {
        ctx.clearRect(0, 0, 1, 1);
        for (const layer of layers) {
          ctx.fillStyle = layer;
          ctx.fillRect(0, 0, 1, 1);
        }
        return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      };
      const alpha = (color: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        return ctx.getImageData(0, 0, 1, 1).data[3];
      };
      const luminance = ([r, g, b]: number[]) => {
        const lin = (c: number) => {
          const v = c / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      };
      return pills.map((pill) => {
        // Backgrounds from the pill outward until an opaque one, crossing
        // the shadow root to its host.
        const layers: string[] = [];
        let node: Element | null = pill;
        while (node != null) {
          const bg = getComputedStyle(node).backgroundColor;
          if (alpha(bg) > 0) layers.unshift(bg);
          if (alpha(bg) === 255) break;
          node =
            node.parentElement ??
            (node.parentNode as ShadowRoot | null)?.host ??
            null;
        }
        const text = paint([getComputedStyle(pill).color]);
        const back = paint(['#fff', ...layers]);
        const [hi, lo] = [luminance(text), luminance(back)].sort(
          (a, b) => b - a
        );
        return {
          pill: pill.textContent,
          text: `rgb(${text.join(', ')})`,
          back: `rgb(${back.join(', ')})`,
          ratio: (hi + 0.05) / (lo + 0.05),
        };
      });
    });
}

// The demo's default themes and common Shiki themes, dark and light. Small
// bold text needs 4.5:1 (WCAG AA).
for (const [theme, type] of [
  ['pierre-dark', 'dark'],
  ['github-dark', 'dark'],
  ['nord', 'dark'],
  ['pierre-light', 'light'],
  ['github-light', 'light'],
] as const) {
  test(`${theme}: ${type}-mode change pills meet WCAG AA contrast`, async ({
    page,
  }) => {
    await page.goto(
      `/test/e2e/fixtures/snippet.html?type=unified&theme=${theme}&themeType=${type}`
    );
    const pills = page.locator(
      '[data-mount="snippet"] [data-gutter] [data-snippet-boundary="above"] [data-snippet-change-counts] > *'
    );
    await expect(pills).toHaveText(['-1', '+1']);
    const measured = await pillContrast(page);
    console.log(
      `pill contrast ${theme}: ${JSON.stringify(measured.map((pill) => ({ ...pill, ratio: pill.ratio.toFixed(3) })))}`
    );
    for (const pill of measured) {
      expect(pill.ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
}
