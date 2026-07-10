import { expect, type Page, test } from '@playwright/test';

const RANGE = '[data-marker-range]';
const CONTENT = '[data-content]';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/markers.html');
  await page.waitForFunction(() => window.__markersReady === true);
}

// Returns true when every element matching `selector` is laid out inside the
// editor's host element (with a 1px tolerance for sub-pixel rounding). Used to
// prove marker squiggles and popups never render outside the editor boundary.
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
  popupLeft: number;
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

    const popup = root.querySelector<HTMLElement>('[data-marker-popup]');
    if (popup == null) {
      return null;
    }
    const popupRect = popup.getBoundingClientRect();
    const gutterRect = gutter.getBoundingClientRect();
    return {
      gutterRight: gutterRect.right,
      popupLeft: popupRect.left,
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

  test('hovering a squiggle shows its message popup', async ({ page }) => {
    await openFixture(page);

    // The popup is driven by a mouseover on the underlying text (hit-tested by
    // line + char), not the overlay squiggle, which sits behind the content.
    await page.locator(CONTENT).getByText('conut').hover();

    const popup = page.locator('[data-marker-popup]');
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Cannot find name conut');
  });

  test('squiggles and popups stay within the editor bounds', async ({
    page,
  }) => {
    await openFixture(page);

    expect(await allWithinHost(page, RANGE)).toBe(true);

    await page.locator(CONTENT).getByText('conut').hover();
    await expect(page.locator('[data-marker-popup]')).toBeVisible();
    expect(await allWithinHost(page, '[data-marker-popup]')).toBe(true);
  });

  test('keeps a horizontally scrolled popup clear of the sticky gutter', async ({
    page,
  }) => {
    await openFixture(page);

    const measurement = await openScrolledMarkerNearGutter(page);
    expect(measurement).not.toBeNull();
    if (measurement === null) {
      return;
    }
    expect(measurement.popupLeft).toBeGreaterThanOrEqual(
      measurement.gutterRight + 7
    );
  });
});
