import { expect, type Locator, type Page, test } from '@playwright/test';

const CONTENT = '[data-content]';

async function openFixture(
  page: Page,
  theme?: { name: string; type: 'dark' | 'light' }
): Promise<void> {
  const query =
    theme == null
      ? ''
      : `?theme=${encodeURIComponent(theme.name)}&themeType=${theme.type}`;
  await page.goto(`/test/e2e/fixtures/theme.html${query}`);
  await page.waitForFunction(() => window.__themeReady === true);
  await page.evaluate(() => document.fonts.ready);
}

const selections = (page: Page): Promise<E2ESelection[] | undefined> =>
  page.evaluate(() => window.__editor?.getState().selections);

const squaredRgbDistance = (left: number[], right: number[]): number =>
  left
    .slice(0, 3)
    .reduce(
      (total, channel, index) => total + (channel - (right[index] ?? 0)) ** 2,
      0
    );

// Reads the rendered text color of the first content token, which differs
// between the dark and light themes.
const tokenColor = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const root = document.querySelector('diffs-container')?.shadowRoot;
    const token = root?.querySelector('[data-content] [data-char]');
    return token != null ? getComputedStyle(token).color : '';
  });

async function captureLineHighlightState(
  page: Page,
  state: E2ELineHighlightState
): Promise<Buffer> {
  const row = await setLineHighlightState(page, state);

  return row.screenshot({
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
}

async function setLineHighlightState(page: Page, state: E2ELineHighlightState) {
  await page.evaluate((nextState) => {
    window.__setLineHighlightState?.(nextState);
  }, state);

  const row = page.locator('[data-content] > [data-line="2"]');
  const selected = state === 'selected' || state === 'both';
  const active = state === 'active' || state === 'both';
  await expect
    .poll(() =>
      row.evaluate((element) => ({
        active: element.hasAttribute('data-editor-active-line'),
        selected: element.hasAttribute('data-selected-line'),
      }))
    )
    .toEqual({ active, selected });

  return row;
}

const elementColors = (element: Locator) =>
  element.evaluate((node) => {
    const probe = document.createElement('span');
    node.append(probe);

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (context == null) {
      throw new Error('Missing canvas context.');
    }

    const resolveColor = (value: string) => {
      probe.style.backgroundColor = value;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(probe).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const backgroundColor = node.hasAttribute('data-line')
      ? getComputedStyle(node, '::after').backgroundColor
      : getComputedStyle(node).backgroundColor;
    const resolved = {
      hoverTarget: resolveColor('var(--diffs-hover-mix-target)'),
      painted: resolveColor(backgroundColor),
    };
    probe.remove();
    return resolved;
  });

test.describe('theme switching', () => {
  test('toggling the theme changes the rendered token colors', async ({
    page,
  }) => {
    await openFixture(page);

    const darkColor = await tokenColor(page);
    await page.locator('[data-toggle-theme]').click();

    await expect.poll(() => tokenColor(page)).not.toBe(darkColor);
  });

  test('a text selection is preserved across a theme switch', async ({
    page,
  }) => {
    await openFixture(page);

    // Build a real selection with the keyboard, then capture it.
    await page.locator(CONTENT).click();
    await page.keyboard.press('ControlOrMeta+ArrowLeft');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Shift+ArrowRight');
    }
    const before = await selections(page);
    expect(before?.[0]).toBeDefined();
    expect(before?.[0]?.start).not.toEqual(before?.[0]?.end);

    await page.locator('[data-toggle-theme]').click();

    // The selection must not move when only the theme changes.
    await expect.poll(() => selections(page)).toEqual(before);
  });
});

test.describe('theme line highlights', () => {
  const themes = [
    { name: 'min-dark', type: 'dark' },
    { name: 'dark-plus', type: 'dark' },
    { name: 'github-dark', type: 'dark' },
    { name: 'github-light', type: 'light' },
    { name: 'nord', type: 'dark' },
    { name: 'pierre-dark', type: 'dark' },
    { name: 'pierre-light', type: 'light' },
  ] as const;

  for (const theme of themes) {
    test(`${theme.name} keeps active and selected line states distinct`, async ({
      page,
    }) => {
      await openFixture(page, theme);

      const none = await captureLineHighlightState(page, 'none');
      const selected = await captureLineHighlightState(page, 'selected');
      const active = await captureLineHighlightState(page, 'active');
      const both = await captureLineHighlightState(page, 'both');

      expect(active.equals(none)).toBe(false);
      expect(both.equals(selected)).toBe(false);
      expect(both.equals(active)).toBe(false);
    });
  }

  test('selection, active, and hover resolve as ordered color tiers', async ({
    page,
  }) => {
    await openFixture(page, { name: 'pierre-light', type: 'light' });
    const row = page.locator('[data-content] > [data-line="2"]');
    const colorsByLineType = [];

    for (const lineType of ['change-addition', 'change-deletion']) {
      await row.evaluate((element, type) => {
        const background = element.closest('pre');
        if (background == null) {
          throw new Error('Missing diff wrapper.');
        }
        background.setAttribute('data-background', '');
        element.setAttribute('data-line-type', type);
        element.removeAttribute('data-hovered');
      }, lineType);

      await setLineHighlightState(page, 'none');
      const none = await elementColors(row);
      await setLineHighlightState(page, 'active');
      const active = await elementColors(row);
      await setLineHighlightState(page, 'selected');
      const selected = await elementColors(row);
      await setLineHighlightState(page, 'both');
      const both = await elementColors(row);
      await row.evaluate((element) => {
        element.setAttribute('data-hovered', '');
      });
      const hovered = await elementColors(row);

      for (const color of [none, active, selected, both, hovered]) {
        expect(color.painted[3]).toBe(255);
      }
      expect(active.painted).not.toEqual(none.painted);
      expect(selected.painted).not.toEqual(none.painted);
      expect(both.painted).not.toEqual(selected.painted);
      expect(both.painted).not.toEqual(active.painted);
      expect(hovered.painted).not.toEqual(both.painted);
      expect(
        squaredRgbDistance(hovered.painted, hovered.hoverTarget)
      ).toBeLessThan(squaredRgbDistance(both.painted, both.hoverTarget));

      colorsByLineType.push({
        active: active.painted,
        both: both.painted,
        hovered: hovered.painted,
        none: none.painted,
        selected: selected.painted,
      });
    }

    const [addition, deletion] = colorsByLineType;
    expect(addition).toBeDefined();
    expect(deletion).toBeDefined();
    for (const state of [
      'none',
      'active',
      'selected',
      'both',
      'hovered',
    ] as const) {
      expect(addition?.[state]).not.toEqual(deletion?.[state]);
    }
  });

  test('the active gutter layers above selection exactly once', async ({
    page,
  }) => {
    await openFixture(page, { name: 'pierre-light', type: 'light' });
    const number = page.locator('[data-gutter] [data-column-number="2"]');

    await setLineHighlightState(page, 'none');
    const none = await elementColors(number);
    await setLineHighlightState(page, 'active');
    const active = await elementColors(number);
    await setLineHighlightState(page, 'selected');
    const selected = await elementColors(number);
    await setLineHighlightState(page, 'both');
    const both = await elementColors(number);

    expect(active.painted).not.toEqual(none.painted);
    expect(selected.painted).not.toEqual(none.painted);
    expect(active.painted).not.toEqual(selected.painted);
    expect(both.painted).not.toEqual(active.painted);
    expect(both.painted).not.toEqual(selected.painted);
  });

  test('rounded selection corners match a selected line background', async ({
    page,
  }) => {
    await openFixture(page, { name: 'pierre-light', type: 'light' });
    await setLineHighlightState(page, 'selected');
    await page.evaluate(() => {
      window.__editor?.setSelections([
        {
          start: { line: 0, character: 10 },
          end: { line: 2, character: 10 },
          direction: 'forward',
        },
      ]);
    });
    await expect(page.locator('[data-selection-corner]')).not.toHaveCount(0);

    const colors = await page.evaluate(() => {
      const root = document.querySelector('diffs-container')?.shadowRoot;
      const row = root?.querySelector<HTMLElement>(
        '[data-content] > [data-line="2"]'
      );
      const corner = [
        ...(root?.querySelectorAll<HTMLElement>('[data-selection-corner]') ??
          []),
      ].find(
        (element) =>
          Math.abs(
            element.getBoundingClientRect().top -
              (row?.getBoundingClientRect().top ?? Number.NaN)
          ) < 0.5
      );
      if (row == null || corner == null) {
        throw new Error('Missing selected row corner.');
      }

      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--diffs-bg)';
      row.append(probe);
      const base = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        base,
        corner: getComputedStyle(corner).backgroundColor,
        line: getComputedStyle(row, '::after').backgroundColor,
      };
    });

    expect(colors.line).not.toBe(colors.base);
    expect(colors.corner).toBe(colors.line);
  });

  test('a missing active background preserves the resolved line color', async ({
    page,
  }) => {
    await openFixture(page, { name: 'dark-plus', type: 'dark' });
    const row = page.locator('[data-content] > [data-line="2"]');
    await row.evaluate((element) => {
      const background = element.closest('pre');
      if (background == null) {
        throw new Error('Missing diff wrapper.');
      }
      background.setAttribute('data-background', '');
      element.setAttribute('data-line-type', 'change-addition');
      element.removeAttribute('data-hovered');
    });

    for (const diffBackground of [true, false]) {
      await row.evaluate((element, enabled) => {
        const background = element.closest('pre');
        if (background == null) {
          throw new Error('Missing diff wrapper.');
        }
        background.toggleAttribute('data-background', enabled);
      }, diffBackground);

      await setLineHighlightState(page, 'none');
      const none = await elementColors(row);
      await setLineHighlightState(page, 'active');
      const active = await elementColors(row);
      await setLineHighlightState(page, 'selected');
      const selected = await elementColors(row);
      await setLineHighlightState(page, 'both');
      const both = await elementColors(row);

      expect(active.painted).toEqual(none.painted);
      expect(both.painted).toEqual(selected.painted);
    }
  });
});
