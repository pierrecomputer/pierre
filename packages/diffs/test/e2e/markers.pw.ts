import { expect, type Page, test } from '@playwright/test';

const RANGE = '[data-marker-range]';
const CONTENT = '[data-content]';

async function openFixture(
  page: Page,
  theme: 'dark' | 'light' = 'dark'
): Promise<void> {
  await page.goto(`/test/e2e/fixtures/markers.html?theme=${theme}`);
  await page.waitForFunction(() => window.__markersReady === true);
}

// Returns true when every element matching `selector` is laid out inside the
// editor's host element (with a 1px tolerance for sub-pixel rounding). Used to
// prove marker squiggles and popovers never render outside the editor boundary.
function allWithinHost(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const host = document.querySelector('diffs-container');
    const root = host?.shadowRoot;
    if (host == null || root == null) {
      return false;
    }
    const hostRect = host.getBoundingClientRect();
    const elements = [...root.querySelectorAll(sel)];
    if (elements.length === 0) {
      return false;
    }
    return elements.every((el) => {
      const rect = el.getBoundingClientRect();
      return (
        rect.left >= hostRect.left - 1 &&
        rect.top >= hostRect.top - 1 &&
        rect.right <= hostRect.right + 1 &&
        rect.bottom <= hostRect.bottom + 1
      );
    });
  }, selector);
}

function openScrolledMarkerNearGutter(page: Page): Promise<{
  gutterRight: number;
  popoverLeft: number;
} | null> {
  return page.evaluate(async () => {
    const host = document.querySelector('diffs-container');
    const root = host?.shadowRoot;
    if (host == null || root == null) {
      return null;
    }

    const code = root.querySelector<HTMLElement>('[data-code]');
    const gutter = root.querySelector<HTMLElement>('[data-gutter]');
    const target = root.querySelector<HTMLElement>(
      '[data-line="6"] [data-char="80"]'
    );
    if (code == null || gutter == null || target == null) {
      return null;
    }

    const codeRect = code.getBoundingClientRect();
    const gutterWidth = gutter.getBoundingClientRect().width;
    const targetRect = target.getBoundingClientRect();
    const targetX = targetRect.left - codeRect.left + code.scrollLeft;
    code.scrollLeft = Math.max(0, targetX - gutterWidth - 4);
    code.dispatchEvent(new Event('scroll', { bubbles: true }));

    target.dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true, composed: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 350));

    const popover = root.querySelector<HTMLElement>('[data-marker-popover]');
    if (popover == null) {
      return null;
    }
    const popoverRect = popover.getBoundingClientRect();
    const gutterRect = gutter.getBoundingClientRect();
    return {
      gutterRight: gutterRect.right,
      popoverLeft: popoverRect.left,
    };
  });
}

// Hovers the marker whose squiggle sits under `token`, then returns the WCAG
// contrast ratio between the popover's resolved text and background colors.
// Guards the marker popover fallback in browsers without contrast-color(): the
// severity fill is a theme editorX.foreground token, so its text candidate must
// remain legible in both light and dark themes.
async function popoverContrast(
  page: Page,
  token: string
): Promise<{
  backgroundColor: string;
  color: string;
  ratio: number;
} | null> {
  await page.locator(CONTENT).getByText(token, { exact: true }).hover();
  await expect(page.locator('[data-marker-popover]')).toBeVisible();
  return page.evaluate(() => {
    const root = document.querySelector('diffs-container')?.shadowRoot;
    const popover = root?.querySelector('[data-marker-popover]');
    if (!(popover instanceof HTMLElement)) {
      return null;
    }
    const cs = getComputedStyle(popover);
    const parse = (color: string): [number, number, number] => {
      const match = color.match(/rgba?\(([^)]+)\)/);
      if (match == null) {
        return [0, 0, 0];
      }
      const [r, g, b] = match[1].split(',').map((part) => parseFloat(part));
      return [r, g, b];
    };
    const luminance = ([r, g, b]: [number, number, number]): number => {
      const channel = (value: number): number => {
        const scaled = value / 255;
        return scaled <= 0.03928
          ? scaled / 12.92
          : ((scaled + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const textLum = luminance(parse(cs.color));
    const bgLum = luminance(parse(cs.backgroundColor));
    const [lighter, darker] =
      textLum > bgLum ? [textLum, bgLum] : [bgLum, textLum];
    return {
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      ratio: (lighter + 0.05) / (darker + 0.05),
    };
  });
}

test.describe('editor markers', () => {
  test('renders one squiggle per severity', async ({ page }) => {
    await openFixture(page);

    await expect(page.locator(RANGE)).toHaveCount(4);
    await expect(page.locator('[data-marker-error]')).toHaveCount(1);
    await expect(page.locator('[data-marker-warning]')).toHaveCount(1);
    await expect(page.locator('[data-marker-info]')).toHaveCount(1);
    await expect(page.locator('[data-marker-hint]')).toHaveCount(1);
  });

  test('hovering a squiggle shows its message popover', async ({ page }) => {
    await openFixture(page);

    // The popover is driven by a mouseover on the underlying text (hit-tested
    // by line + char), not the overlay squiggle, which sits behind the content.
    await page.locator(CONTENT).getByText('conut').hover();

    const popover = page.locator('[data-marker-popover]');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('Cannot find name conut');
  });

  test('squiggles and popovers stay within the editor bounds', async ({
    page,
  }) => {
    await openFixture(page);

    expect(await allWithinHost(page, RANGE)).toBe(true);

    await page.locator(CONTENT).getByText('conut').hover();
    await expect(page.locator('[data-marker-popover]')).toBeVisible();
    expect(await allWithinHost(page, '[data-marker-popover]')).toBe(true);
  });

  // Regression test: the fallback used the editor background for every theme,
  // producing white text on Pierre Light's yellow warning marker. Every visible
  // severity popover must clear WCAG AA in both configured themes.
  test('marker popovers keep readable contrast across themes and severities', async ({
    page,
  }) => {
    for (const theme of ['dark', 'light'] as const) {
      await openFixture(page, theme);

      for (const token of ['count', 'conut', 'var']) {
        const sample = await popoverContrast(page, token);
        expect(sample).not.toBeNull();
        expect(
          sample!.ratio,
          `${theme} theme marker under "${token}": ${sample!.color} on ${sample!.backgroundColor}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('keeps a horizontally scrolled popover clear of the sticky gutter', async ({
    page,
  }) => {
    await openFixture(page);

    const measurement = await openScrolledMarkerNearGutter(page);
    expect(measurement).not.toBeNull();
    if (measurement === null) {
      return;
    }
    expect(measurement.popoverLeft).toBeGreaterThanOrEqual(
      measurement.gutterRight + 7
    );
  });
});
