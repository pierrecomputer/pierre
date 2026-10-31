import { expect, type Page, test } from '@playwright/test';

import {
  expectCurrentMatchHorizontallyVisible,
  resetCurrentMatchHorizontalScroll,
  trackHorizontalSearchScrolls,
} from './search-scroll-helpers';

const CONTENT = '[data-content]';
const PANEL = '[data-search-panel]';
const SEARCH_INPUT = '[data-search-panel] input[data-search]';
const REPLACE_INPUT = '[data-search-panel] input[data-replace]';
const MATCHES = '[data-search-panel] [data-matches]';

async function expectNativeHighlights(
  page: Page,
  count: number
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (CSS.highlights.get('diffs-search-match')?.size ?? 0) +
          (CSS.highlights.get('diffs-search-current')?.size ?? 0)
      )
    )
    .toBe(count);
}

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/editable.html');
  await page.waitForFunction(() => window.__editableReady === true);
}

const contents = (page: Page): Promise<string> =>
  page.evaluate(() => window.__editor?.getText() ?? '');

// Focus the editor surface, then open the search panel with the real shortcut.
// The panel container is a zero-height CSS grid wrapper (its cells are laid out
// individually), so wait on the visible search input rather than the wrapper.
async function openSearchPanel(page: Page): Promise<void> {
  await page.locator(CONTENT).click();
  await page.keyboard.press('ControlOrMeta+f');
  await expect(page.locator(SEARCH_INPUT)).toBeVisible();
}

for (const nested of [false, true]) {
  test(`search reveals horizontal matches instantly in a ${nested ? 'nested' : 'document'} editor viewport`, async ({
    page,
  }) => {
    await page.goto(
      `/test/e2e/fixtures/editable.html?horizontal${nested ? '&nested' : ''}`
    );
    await page.waitForFunction(() => window.__editableReady === true);
    await page.locator(CONTENT).focus();
    const selections = await page.evaluate(
      () => window.__editor!.getViewState().selections
    );
    const scrollTop = () =>
      page.evaluate(
        (nested) =>
          nested
            ? document.querySelector('[data-diff-mount]')!.scrollTop
            : window.scrollY,
        nested
      );
    await page.keyboard.press('ControlOrMeta+f');
    const input = page.locator(SEARCH_INPUT);
    await input.fill('target');
    await expect(page.locator(MATCHES)).toHaveText('1 of 4');
    await expectCurrentMatchHorizontallyVisible(page);
    const initialTop = await scrollTop();
    const probe = await trackHorizontalSearchScrolls(page);
    try {
      await input.press('Enter');
      await expect(page.locator(MATCHES)).toHaveText('2 of 4');
      await expectCurrentMatchHorizontallyVisible(page);
      expect(await scrollTop()).toBe(initialTop);
      await resetCurrentMatchHorizontalScroll(page);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      );
      expect(
        await page.evaluate(() => {
          const range = [
            ...CSS.highlights.get('diffs-search-current')!,
          ][0] as Range;
          return range.startContainer.parentElement!.closest('[data-code]')!
            .scrollLeft;
        })
      ).toBe(0);
      await input.press('Shift+Enter');
      await expectCurrentMatchHorizontallyVisible(page);
      await input.press('Enter');
      await expectCurrentMatchHorizontallyVisible(page);
      expect(await scrollTop()).toBe(initialTop);
      await input.press('Enter');
      await expectCurrentMatchHorizontallyVisible(page);
      expect(await scrollTop()).toBe(initialTop);
      await input.press('Enter');
      await expect(page.locator(MATCHES)).toHaveText('4 of 4');
      await expectCurrentMatchHorizontallyVisible(page);
      expect(await scrollTop()).toBeGreaterThan(initialTop);
      const calls = await probe.evaluate(({ calls }) => calls);
      expect(calls.length).toBeGreaterThan(0);
      expect(
        calls.every(
          ({ behavior, immediate, verticalUnchanged }) =>
            behavior === 'instant' && immediate && verticalUnchanged
        )
      ).toBe(true);
      expect(
        await page.evaluate(() => window.__editor!.getViewState().selections)
      ).toEqual(selections);
      await expect(input).toBeFocused();
    } finally {
      await probe.evaluate(({ restore }) => restore());
      await probe.dispose();
    }
  });
}

test.describe('find and replace', () => {
  test('Cmd/Ctrl+F opens the panel and reports match counts', async ({
    page,
  }) => {
    await openFixture(page);
    await openSearchPanel(page);

    await page.locator(SEARCH_INPUT).fill('foo');

    // "foo" appears four times across the three lines.
    await expect(page.locator(MATCHES)).toContainText('4');
    await expectNativeHighlights(page, 4);
    await expect(page.locator('[data-match-range]')).toHaveCount(0);
    await expect(
      page.locator('[data-search-panel] [data-no-matches]')
    ).toHaveCount(0);

    await page.locator(SEARCH_INPUT).fill('nope');
    await expect(page.locator(MATCHES)).toContainText('No results');
  });

  test('switching to replace mode and Replace All rewrites every match', async ({
    page,
  }) => {
    await openFixture(page);
    await openSearchPanel(page);

    await page.locator(SEARCH_INPUT).fill('foo');
    // Cmd/Ctrl+Alt+F toggles the panel into find/replace mode in place.
    await page.keyboard.press('ControlOrMeta+Alt+f');
    await expect(page.locator('[data-search-grid]')).toHaveAttribute(
      'data-mode',
      'replace'
    );

    await page.locator(REPLACE_INPUT).fill('qux');
    await page
      .locator('[data-replace-actions] button[aria-label="Replace All"]')
      .click();

    await expect.poll(() => contents(page)).toContain('const qux = 1;');
    await expect.poll(() => contents(page)).toContain('const bar = qux + qux;');
    await expect.poll(() => contents(page)).not.toContain('foo');
    await expectNativeHighlights(page, 0);
    await page.locator(CONTENT).focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expectNativeHighlights(page, 4);
  });

  test('the chevron shows and hides the replace row', async ({ page }) => {
    await openFixture(page);
    await openSearchPanel(page);

    const toggle = page.locator('[data-search-panel] [data-replace-toggle]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(REPLACE_INPUT)).toBeHidden();
    const collapsedBox = await toggle.boundingBox();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(REPLACE_INPUT)).toBeVisible();
    await expect(page.locator(REPLACE_INPUT)).toBeFocused();
    // The chevron stays beside the find input while the replace row opens.
    expect(await toggle.boundingBox()).toEqual(collapsedBox);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(REPLACE_INPUT)).toBeHidden();
    await expect(page.locator(SEARCH_INPUT)).toBeFocused();
  });

  test('clearing the query removes the match highlights', async ({ page }) => {
    await openFixture(page);
    await openSearchPanel(page);

    await page.locator(SEARCH_INPUT).fill('foo');
    await expect(page.locator(MATCHES)).toContainText('4');
    await expectNativeHighlights(page, 4);

    // Emptying the query returns the panel to its "No results" state; the
    // highlights must clear with it rather than linger over an empty box.
    await page.locator(SEARCH_INPUT).fill('');
    await expect(page.locator(MATCHES)).toContainText('No results');
    await expectNativeHighlights(page, 0);
  });

  test('Escape in the search input closes the panel and clears highlights', async ({
    page,
  }) => {
    await openFixture(page);
    await openSearchPanel(page);

    await page.locator(SEARCH_INPUT).fill('foo');
    await expectNativeHighlights(page, 4);

    // Escape while the search input holds focus is the already-correct teardown
    // path; keep it covered as the counterpart to the content-Escape case.
    await page.locator(SEARCH_INPUT).press('Escape');

    await expect(page.locator(PANEL)).toHaveCount(0);
    await expectNativeHighlights(page, 0);
  });

  test('Escape from the editor content closes the panel and clears highlights', async ({
    page,
  }) => {
    await openFixture(page);
    await openSearchPanel(page);

    await page.locator(SEARCH_INPUT).fill('foo');
    await expectNativeHighlights(page, 4);

    // Click into the editor text so focus leaves the search input, then press
    // Escape. This is handled by the content-focused keydown handler, a
    // separate teardown path that must clear the highlights too.
    await page.locator(CONTENT).click();
    await expect(page.locator(SEARCH_INPUT)).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.locator(PANEL)).toHaveCount(0);
    await expectNativeHighlights(page, 0);
  });
});

test('native editor highlights cross tokens and track typing, undo, and row replacement', async ({
  page,
}) => {
  await openFixture(page);
  await openSearchPanel(page);
  const input = page.locator(SEARCH_INPUT);
  await input.fill('foo + foo');
  await expectNativeHighlights(page, 1);
  expect(
    await page.evaluate(() =>
      [...CSS.highlights.values()].flatMap((highlight) =>
        [...highlight].map((range) => (range as Range).toString())
      )
    )
  ).toEqual(['foo + foo']);
  await input.fill('foo');
  await expectNativeHighlights(page, 4);
  await expect(page.locator('[data-match-range]')).toHaveCount(0);
  const row = page.locator(CONTENT).locator('[data-line="2"]');
  const textNodes = await row.evaluateHandle((row) => {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    const nodes: Node[] = [];
    let node;
    while ((node = walker.nextNode()) != null) nodes.push(node);
    return nodes;
  });
  await input.press('Enter');
  await expect(page.locator(MATCHES)).toContainText('of 4');
  await expect
    .poll(() =>
      page.evaluate(() => CSS.highlights.get('diffs-search-current')?.size)
    )
    .toBe(1);
  expect(
    await textNodes.evaluate(
      (nodes) => nodes.length > 0 && nodes.every((node) => node.isConnected)
    )
  ).toBe(true);
  await page.evaluate(() =>
    window.__editor?.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: '// 🦊 foo\n',
      },
    ])
  );
  await expectNativeHighlights(page, 5);
  await page.locator(CONTENT).focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expectNativeHighlights(page, 4);
  await page.evaluate(() => window.__renderEditorWindow?.(0));
  await expectNativeHighlights(page, 4);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...CSS.highlights.values()].flatMap((highlight) =>
          [...highlight].map((range) => (range as Range).toString())
        )
      )
    )
    .toEqual(['foo', 'foo', 'foo', 'foo']);
  await page.evaluate(() => window.__editor?.cleanUp());
  await expectNativeHighlights(page, 0);
  await textNodes.dispose();
});

test('native editor highlights follow the mounted window, not every document match', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/editable.html?windowed');
  await page.waitForFunction(() => window.__editableReady === true);
  await openSearchPanel(page);
  await page.locator(SEARCH_INPUT).fill('foo');
  await expect(page.locator(MATCHES)).toContainText('600');
  await expectNativeHighlights(page, 40);
  await page.evaluate(() => window.__renderEditorWindow?.(200));
  await expect(page.locator(CONTENT).locator('[data-line="1"]')).toHaveCount(0);
  await expectNativeHighlights(page, 40);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [
          ...new Set(
            [...CSS.highlights.values()].flatMap((highlight) =>
              [...highlight].map((range) =>
                Number(
                  range.startContainer.parentElement
                    ?.closest('[data-line]')
                    ?.getAttribute('data-line')
                )
              )
            )
          ),
        ].sort((a, b) => a - b)
      )
    )
    .toEqual(Array.from({ length: 20 }, (_, index) => index + 201));
  await page.evaluate(() => window.__renderEditorWindow?.(0));
  await expectNativeHighlights(page, 40);
  await page.locator(SEARCH_INPUT).press('Escape');
  await expectNativeHighlights(page, 0);
});

for (const diffStyle of ['split', 'unified']) {
  test(`native editor search reveals collapsed context in ${diffStyle}`, async ({
    page,
  }) => {
    await page.goto(
      `/test/e2e/fixtures/edit-collapsed.html?diffStyle=${diffStyle}`
    );
    await page.waitForFunction(() => window.__editReady === true);
    const content = page.locator('[contenteditable="true"]');
    await expect(content.locator('[data-line="30"]')).toHaveCount(0);
    await content
      .locator('[data-line="10"]:not([data-line-type="change-deletion"])')
      .click();
    await page.keyboard.press('ControlOrMeta+f');
    await page.locator(SEARCH_INPUT).fill('line 30');
    await expectNativeHighlights(page, 1);
    await expect(content.locator('[data-line="30"]')).toBeInViewport();
    await expect(page.locator('[data-match-range]')).toHaveCount(0);
    expect(
      await page.evaluate(() => {
        const range = [
          ...CSS.highlights.get('diffs-search-current')!,
        ][0] as Range;
        return range.toString();
      })
    ).toBe('line 30');
    await page.locator(SEARCH_INPUT).press('Escape');
    await expectNativeHighlights(page, 0);
  });
}

test('find keeps editor selections unchanged and paints without selection overlays', async ({
  page,
}) => {
  await openFixture(page);
  await page.locator(CONTENT).focus();
  await page.evaluate(() =>
    window.__editor?.setSelections([
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
        direction: 'forward',
      },
    ])
  );
  const selected = await page.evaluate(
    () => window.__editor?.getViewState().selections
  );
  const selection = page.locator('[data-selection-range]');
  await expect(selection).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+f');
  const input = page.locator(SEARCH_INPUT);
  await expect(input).toHaveValue('const');
  expect(
    await page.evaluate(() => window.__editor?.getViewState().selections)
  ).toEqual(selected);

  const probe = await page
    .locator('[data-editor-overlay]')
    .evaluateHandle((overlay) => {
      const state = { selectionNodes: 0 };
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of [...record.addedNodes, ...record.removedNodes]) {
            if (
              node instanceof Element &&
              (node.matches('[data-selection-range], [data-caret]') ||
                node.querySelector('[data-selection-range], [data-caret]') !=
                  null)
            ) {
              state.selectionNodes++;
            }
          }
        }
      });
      observer.observe(overlay, { childList: true, subtree: true });
      return { state, observer };
    });
  await input.fill('foo');
  await input.press('Enter');
  await input.press('Shift+Enter');
  await page.keyboard.press('ControlOrMeta+g');
  await expectNativeHighlights(page, 4);
  await input.fill('baz');
  await expectNativeHighlights(page, 1);
  await input.fill('foo');
  await page.keyboard.press('ControlOrMeta+Alt+f');
  await page.locator(REPLACE_INPUT).fill('bar');
  await page.locator('[data-search-panel] button[aria-label="Next"]').click();
  await input.focus();
  expect(
    await page.evaluate(() => window.__editor?.getViewState().selections)
  ).toEqual(selected);
  await expect(selection).toHaveCount(1);
  await input.press('Escape');
  expect(
    await page.evaluate(() => window.__editor?.getViewState().selections)
  ).toEqual(selected);
  expect(
    await probe.evaluate(({ state, observer }) => {
      observer.disconnect();
      return state.selectionNodes;
    })
  ).toBe(0);
  await probe.dispose();

  await page.locator(CONTENT).focus();
  await page.keyboard.type('let');
  await expect.poll(() => contents(page)).toMatch(/^let foo/);
  expect((await contents(page)).match(/foo/g)?.length).toBe(4);
});

test('opening find at a caret reads the word without selecting it', async ({
  page,
}) => {
  await openFixture(page);
  await page.locator(CONTENT).focus();
  await page.evaluate(() =>
    window.__editor?.setSelections([
      {
        start: { line: 0, character: 7 },
        end: { line: 0, character: 7 },
        direction: 'forward',
      },
    ])
  );
  const selected = await page.evaluate(
    () => window.__editor?.getViewState().selections
  );
  await page.keyboard.press('ControlOrMeta+f');
  const input = page.locator(SEARCH_INPUT);
  await expect(input).toHaveValue('foo');
  await expectNativeHighlights(page, 4);
  await input.press('Enter');
  await input.press('Escape');
  expect(
    await page.evaluate(() => window.__editor?.getViewState().selections)
  ).toEqual(selected);
  await expect(page.locator('[data-selection-range]')).toHaveCount(0);
});

for (const nested of [false, true]) {
  test(`find preserves the viewport until the first scroll, then centers navigation in a ${nested ? 'nested' : 'document'} viewport`, async ({
    page,
  }) => {
    await page.goto(
      `/test/e2e/fixtures/editable.html?viewport${nested ? '&nested' : ''}`
    );
    await page.waitForFunction(() => window.__editableReady === true);
    await page.locator(CONTENT).focus();
    await page.evaluate(() =>
      window.__editor?.setSelections([
        {
          start: { line: 100, character: 1 },
          end: { line: 100, character: 1 },
          direction: 'none',
        },
      ])
    );
    const selected = await page.evaluate(
      () => window.__editor?.getViewState().selections
    );
    const getScroll = () =>
      page.evaluate(
        (nested) =>
          nested
            ? document.querySelector('[data-diff-mount]')!.scrollTop
            : window.scrollY,
        nested
      );
    const expectCentered = (line: number) =>
      expect
        .poll(() =>
          page
            .locator(CONTENT)
            .locator(`[data-line="${line}"]`)
            .evaluate((element, nested) => {
              const row = element.getBoundingClientRect();
              const viewport = nested
                ? document
                    .querySelector('[data-diff-mount]')!
                    .getBoundingClientRect()
                : { top: 0, bottom: window.innerHeight };
              return Math.abs(
                (row.top + row.bottom) / 2 -
                  (viewport.top + viewport.bottom) / 2
              );
            }, nested)
        )
        .toBeLessThan(32);
    const offsetViewport = () =>
      page.evaluate((nested) => {
        if (nested)
          document.querySelector('[data-diff-mount]')!.scrollTop += 12;
        else window.scrollBy(0, 12);
      }, nested);
    await expect(
      page.locator(CONTENT).locator('[data-line="100"]')
    ).toBeInViewport();
    await expect(
      page.locator(CONTENT).locator('[data-line="101"]')
    ).toBeInViewport();
    await expect(
      page.locator(CONTENT).locator('[data-line="20"]')
    ).not.toBeInViewport();
    const initialScroll = await getScroll();
    await page.keyboard.press('ControlOrMeta+f');
    const input = page.locator(SEARCH_INPUT);
    // Earlier matches are offscreen; find starts at the first visible occurrence.
    await expect(input).toHaveValue('target');
    await expect(page.locator(MATCHES)).toHaveText('2 of 4');
    expect(await getScroll()).toBe(initialScroll);
    await input.press('Enter');
    await expect(page.locator(MATCHES)).toHaveText('3 of 4');
    expect(await getScroll()).toBe(initialScroll);
    await input.press('Enter');
    await expect(page.locator(MATCHES)).toHaveText('4 of 4');
    // The editor reserves space above the centered result for the search panel.
    await expectCentered(161);
    await input.press('Shift+Enter');
    await expect(page.locator(MATCHES)).toHaveText('3 of 4');
    await expectCentered(101);
    const centered101 = await getScroll();
    await page.evaluate(() =>
      window.__editor!.applyEdits([
        {
          range: {
            start: { line: 190, character: 0 },
            end: { line: 190, character: 0 },
          },
          newText: 'target ',
        },
      ])
    );
    await expect(page.locator(MATCHES)).toHaveText('3 of 5');
    await input.press('Shift+Enter');
    await expect(page.locator(MATCHES)).toHaveText('2 of 5');
    await expect.poll(getScroll).toBeLessThan(centered101 - 10);
    await expectCentered(100);
    await input.press('Enter');
    await expectCentered(101);
    await input.press('Enter');
    await expectCentered(161);
    await offsetViewport();
    const centeredScroll = await getScroll();
    await page.keyboard.press('ControlOrMeta+Alt+f');
    await page.locator(REPLACE_INPUT).fill('new');
    await expect(page.locator(MATCHES)).toHaveText('4 of 5');
    expect(await getScroll()).toBe(centeredScroll);
    await input.fill('TARGET');
    await expect(page.locator(MATCHES)).toHaveText('4 of 5');
    expect(await getScroll()).toBe(centeredScroll);
    // Wrap backward from the first match after wrapping forward past the last.
    await input.press('Enter');
    await expect(page.locator(MATCHES)).toHaveText('5 of 5');
    await input.press('Enter');
    await expect(page.locator(MATCHES)).toHaveText('1 of 5');
    await expectCentered(20);
    await input.press('Shift+Enter');
    await expect(page.locator(MATCHES)).toHaveText('5 of 5');
    await expect(
      page.locator(CONTENT).locator('[data-line="191"]')
    ).toBeInViewport();
    await input.press('Shift+Enter');
    await expectCentered(161);
    await offsetViewport();
    const beforeOption = await getScroll();
    await page
      .locator('[data-search-panel]')
      .getByRole('button', { name: 'Whole Word', exact: true })
      .click();
    await expect(page.locator(MATCHES)).toHaveText('4 of 5');
    expect(await getScroll()).toBe(beforeOption);
    expect(
      await page.evaluate(() => window.__editor?.getViewState().selections)
    ).toEqual(selected);
  });
}

test('first-visible lookup keeps full-document results with bounded DOM work', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/editable.html?large');
  await page.waitForFunction(() => window.__editableReady === true);
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    window.__editor?.setSelections([
      {
        start: { line: 9995, character: 0 },
        end: { line: 9995, character: 0 },
        direction: 'none',
      },
    ]);
  });
  const selected = await page.evaluate(
    () => window.__editor?.getViewState().selections
  );
  await page.keyboard.press('ControlOrMeta+f');
  await expect(page.locator(MATCHES)).toContainText('of 10000');
  const result = await page.locator(SEARCH_INPUT).evaluate((input) => {
    const rect = Element.prototype.getBoundingClientRect;
    const query = ShadowRoot.prototype.querySelector;
    let rowMeasurements = 0;
    let headerQueries = 0;
    Element.prototype.getBoundingClientRect = function () {
      if (this.hasAttribute('data-line')) rowMeasurements++;
      return rect.call(this);
    };
    ShadowRoot.prototype.querySelector = function (selector: string) {
      if (selector.includes('data-diffs-header')) headerQueries++;
      return query.call(this, selector);
    };
    const scrollBefore = window.scrollY;
    try {
      (input as HTMLInputElement).value = 'targe';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const current = [
        ...(CSS.highlights.get('diffs-search-current') ?? []),
      ][0] as Range;
      const row = current.startContainer.parentElement?.closest('[data-line]');
      return {
        rowMeasurements,
        headerQueries,
        line: Number(row?.getAttribute('data-line')),
        scrollBefore,
        scrollAfter: window.scrollY,
      };
    } finally {
      Element.prototype.getBoundingClientRect = rect;
      ShadowRoot.prototype.querySelector = query;
    }
  });
  expect(result.line).toBeGreaterThan(9900);
  expect(result.rowMeasurements).toBeLessThan(100);
  expect(result.headerQueries).toBeLessThan(5);
  expect(result.scrollAfter).toBe(result.scrollBefore);
  await expect(page.locator(MATCHES)).toContainText('of 10000');
  expect(
    await page.evaluate(() => window.__editor?.getViewState().selections)
  ).toEqual(selected);
});

test('initial search indexes results after the mounted editor window before wrapping', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/editable.html?candidates&windowed');
  await page.waitForFunction(() => window.__editableReady === true);
  await page.evaluate(() => window.__renderEditorWindow?.(500));
  await page.locator(CONTENT).focus();
  await page.keyboard.press('ControlOrMeta+f');
  const input = page.locator(SEARCH_INPUT);
  await input.fill('target');
  await expect(page.locator(MATCHES)).toHaveText('2 of 3');
  await page.evaluate(() => window.__renderEditorWindow?.(2500));
  await input.fill('TARGET');
  await expect(page.locator(MATCHES)).toHaveText('1 of 3');
});
