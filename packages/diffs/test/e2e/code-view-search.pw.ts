import { expect, type Locator, test } from '@playwright/test';

import type { CodeViewOptions } from '../../src/components/CodeView';
import {
  expectCurrentMatchHorizontallyVisible,
  getCurrentMatchLine,
  resetCurrentMatchHorizontalScroll,
  trackHorizontalSearchScrolls,
} from './search-scroll-helpers';

// Native highlights are ranges in the document registry, not span elements.
// Follow shadow hosts when checking whether a range belongs to this surface.
async function expectSearchHighlights(container: Locator, count: number) {
  await expect
    .poll(() =>
      container.evaluateAll((containers) => {
        const ranges = [
          ...(CSS.highlights.get('diffs-search-match') ?? []),
          ...(CSS.highlights.get('diffs-search-current') ?? []),
        ];
        return ranges.filter((range) => {
          if (range.collapsed) return false;
          let node: Node | null = range.startContainer;
          while (node != null) {
            if (containers.some((container) => container === node)) return true;
            node = node instanceof ShadowRoot ? node.host : node.parentNode;
          }
          return false;
        }).length;
      })
    )
    .toBe(count);
}

for (const kind of ['file', 'split', 'unified'] as const) {
  test(`scoped find preserves selections across recycling in ${kind}`, async ({
    page,
  }) => {
    await page.goto(
      `/test/e2e/fixtures/code-view-search.html?recycle&kind=${kind}&diffStyle=${kind}`
    );
    const root = page.locator('[data-code-view-root]');
    const content = root.locator('[contenteditable="true"]');
    const selection = root.locator('[data-selection-range]');
    await content.focus();
    await page.evaluate(() =>
      window.__codeView?.getEditor('item')?.setSelections([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 4 },
          direction: 'forward',
        },
      ])
    );
    const selected = await page.evaluate(
      () => window.__codeView?.getEditor('item')?.getViewState().selections
    );
    await expect(selection).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+f');
    const input = root.getByRole('textbox', { name: 'Search' });
    await input.fill('target');
    await input.press('Enter');
    await expect(root.locator('[data-matches]')).toHaveText('2 of 2');
    await expect(selection).toHaveCount(1);
    expect(
      await page.evaluate(
        () => window.__codeView?.getEditor('item')?.getViewState().selections
      )
    ).toEqual(selected);
    await root.hover();
    await page.mouse.wheel(0, 6000);
    await expect(content).toHaveCount(0);
    await page.evaluate(() =>
      window.__codeView?.scrollTo({
        type: 'position',
        position: 0,
        behavior: 'instant',
      })
    );
    await expect(content).toBeVisible();
    await expect(input).toBeFocused();
    await expect(selection).toHaveCount(1);
    await page.evaluate(() =>
      window.__codeView?.updateItemId('item', 'renamed')
    );
    await input.press('Escape');
    await expect(selection).toHaveCount(1);
    expect(
      await page.evaluate(
        () => window.__codeView?.getEditor('renamed')?.getViewState().selections
      )
    ).toEqual(selected);
  });

  test(`native highlights preserve code DOM and survive recycling in ${kind}`, async ({
    page,
  }) => {
    await page.goto(
      `/test/e2e/fixtures/code-view-search.html?highlight&kind=${kind}&diffStyle=${kind}`
    );
    const root = page.locator('[data-code-view-root]');
    await root.focus();
    await page.keyboard.press('ControlOrMeta+f');
    const input = root.getByRole('textbox', { name: 'Search' });

    // This query crosses the identifier, operator, and string token spans.
    await input.fill('value = "target');
    await expectSearchHighlights(root, kind === 'split' ? 2 : 1);
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...CSS.highlights.values()].flatMap((highlight) =>
            [...highlight].map((range) => (range as Range).toString())
          )
        )
      )
      .toEqual(Array(kind === 'split' ? 2 : 1).fill('value = "target'));

    await input.fill('target');
    const count = kind === 'split' ? 6 : kind === 'unified' ? 4 : 3;
    await expectSearchHighlights(root, count);
    await expect(root.locator('[data-search-match]')).toHaveCount(0);
    const code = root.locator('diffs-container').first();
    await expect(code.locator('[data-line="1"] span').first()).toBeVisible();
    const probe = await code.evaluateHandle((element) => {
      const rows = [
        ...element.shadowRoot!.querySelectorAll('[data-line][data-line-type]'),
      ];
      const state = { nodes: [] as Node[], mutations: 0 };
      const observer = new MutationObserver((records) => {
        state.mutations += records.length;
      });
      for (const row of rows) {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode()) != null) state.nodes.push(node);
        observer.observe(row, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
      return { state, observer };
    });
    await input.press('Enter');
    await expect(root.locator('[data-matches]')).toHaveText(`2 of ${count}`);
    await expectSearchHighlights(root, count);
    await input.fill('value = "target');
    await expectSearchHighlights(root, kind === 'split' ? 2 : 1);
    await input.fill('target');
    await expectSearchHighlights(root, count);
    expect(
      await probe.evaluate(({ state, observer }) => {
        observer.disconnect();
        return {
          retained:
            state.nodes.length > 0 && state.nodes.every((n) => n.isConnected),
          mutations: state.mutations,
        };
      })
    ).toEqual({ retained: true, mutations: 0 });
    expect(
      await page.evaluate(() => {
        const range = [...CSS.highlights.get('diffs-search-current')!][0];
        return getComputedStyle(
          range.startContainer.parentElement!,
          '::highlight(diffs-search-current)'
        ).backgroundColor;
      })
    ).not.toBe('rgba(0, 0, 0, 0)');

    await root.hover();
    await page.mouse.wheel(0, 6000);
    await expectSearchHighlights(root, 0);
    await page.evaluate(() =>
      window.__codeView?.scrollTo({
        type: 'position',
        position: 0,
        behavior: 'instant',
      })
    );
    await expectSearchHighlights(root, count);
    await input.press('Escape');
    await expectSearchHighlights(root, 0);
    await probe.dispose();
  });
}

for (const kind of ['file', 'split', 'unified']) {
  for (const edit of [false, true]) {
    test(`search reveals horizontal matches instantly in ${kind} ${edit ? 'edit' : 'readonly'}`, async ({
      page,
    }) => {
      await page.goto(
        `/test/e2e/fixtures/code-view-search.html?horizontal&kind=${kind}&diffStyle=${kind}${edit ? '&edit' : ''}`
      );
      const root = page.locator('[data-code-view-root]');
      if (edit) await root.locator('[contenteditable="true"]').focus();
      else await root.focus();
      const selections = await page.evaluate(
        () => window.__codeView!.getEditor('item')?.getViewState().selections
      );
      await page.keyboard.press('ControlOrMeta+f');
      const input = root.getByRole('textbox', { name: 'Search' });
      await input.fill('target');
      await expectCurrentMatchHorizontallyVisible(page);
      const initialTop = await root.evaluate((element) => element.scrollTop);
      const probe = await trackHorizontalSearchScrolls(page);
      try {
        await input.press('Enter');
        await expectCurrentMatchHorizontallyVisible(page);
        expect(await root.evaluate((element) => element.scrollTop)).toBe(
          initialTop
        );
        await resetCurrentMatchHorizontalScroll(page);
        await page.evaluate(() => window.__codeView!.render(true));
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
        expect(await root.evaluate((element) => element.scrollTop)).toBe(
          initialTop
        );
        for (
          let step = 0;
          step < 8 && (await getCurrentMatchLine(page)) !== 201;
          step++
        ) {
          await input.press('Enter');
          await expectCurrentMatchHorizontallyVisible(page);
        }
        expect(await getCurrentMatchLine(page)).toBe(201);
        await expect
          .poll(() => root.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(initialTop);
        await input.fill('xxxxxxxx target');
        await expectCurrentMatchHorizontallyVisible(page);
        await expect(root.locator('[data-matches]')).toHaveText('1 of 1');
        await resetCurrentMatchHorizontalScroll(page);
        await input.press('Enter');
        await expectCurrentMatchHorizontallyVisible(page);
        const calls = await probe.evaluate(({ calls }) => calls);
        expect(calls.length).toBeGreaterThan(0);
        expect(
          calls.every(
            ({ behavior, immediate, verticalUnchanged }) =>
              behavior === 'instant' && immediate && verticalUnchanged
          )
        ).toBe(true);
        expect(
          await page.evaluate(
            () =>
              window.__codeView!.getEditor('item')?.getViewState().selections
          )
        ).toEqual(selections);
        await expect(input).toBeFocused();
      } finally {
        await probe.evaluate(({ restore }) => restore());
        await probe.dispose();
      }
    });
  }
}

for (const theme of ['ansi', 'missing', 'explicit']) {
  for (const edit of [false, true]) {
    test(`search colors follow ${theme} themes in ${edit ? 'edit' : 'readonly'} with native highlights`, async ({
      page,
    }) => {
      await page.goto(
        `/test/e2e/fixtures/code-view-search.html?highlight&kind=file&search-theme=${theme}${edit ? '&edit' : ''}`
      );
      const root = page.locator('[data-code-view-root]');
      if (edit) await root.locator('[contenteditable="true"]').focus();
      else await root.focus();
      await page.keyboard.press('ControlOrMeta+f');
      await root.getByRole('textbox', { name: 'Search' }).fill('target');
      await expect(root.locator('[data-matches]')).toHaveText('1 of 3');
      for (const mode of ['dark', 'light'] as const) {
        await page.evaluate((themeType) => {
          const view = window.__codeView!;
          const { options } = view as unknown as {
            options: CodeViewOptions<undefined, undefined>;
          };
          view.setOptions({ ...options, themeType });
        }, mode);
        await expect
          .poll(() =>
            root
              .locator('diffs-container')
              .first()
              .evaluate((element) => getComputedStyle(element).colorScheme)
          )
          .toBe(mode);
        const input = root.getByRole('textbox', { name: 'Search' });
        await input.fill('');
        await input.fill('target');
        await expect
          .poll(() =>
            page.evaluate(
              ({ theme, mode }) => {
                const color = (current: boolean) => {
                  const name = current
                    ? 'diffs-search-current'
                    : 'diffs-search-match';
                  const range = [...(CSS.highlights.get(name) ?? [])][0] as
                    | Range
                    | undefined;
                  return range == null
                    ? ''
                    : getComputedStyle(
                        range.startContainer.parentElement!,
                        `::highlight(${name})`
                      ).backgroundColor;
                };
                const yellow =
                  theme === 'missing'
                    ? '#eab308'
                    : mode === 'light'
                      ? '#b68d05'
                      : '#f2d04b';
                const probe = document.createElement('div');
                document.body.append(probe);
                try {
                  const expected = (current: boolean) => {
                    const source =
                      theme === 'explicit'
                        ? current
                          ? '#65432166'
                          : '#12345644'
                        : current
                          ? '#009fff66'
                          : yellow;
                    probe.style.backgroundColor = source;
                    return getComputedStyle(probe).backgroundColor;
                  };
                  return [false, true].map((current) => {
                    const actual = color(current);
                    const wanted = expected(current);
                    return actual === wanted ? null : { actual, wanted };
                  });
                } finally {
                  probe.remove();
                }
              },
              { theme, mode }
            )
          )
          .toEqual([null, null]);
      }
    });
  }
}

test('closing or resetting one viewer preserves another viewer’s ranges', async ({
  page,
}) => {
  await page.goto(
    '/test/e2e/fixtures/code-view-search.html?highlight&kind=file&multiple'
  );
  const first = page.locator('[data-code-view-root]');
  const second = page.locator('[data-secondary-view]');
  for (const root of [first, second]) {
    await root.focus();
    await page.keyboard.press('ControlOrMeta+f');
    await root.getByRole('textbox', { name: 'Search' }).fill('target');
  }
  await expectSearchHighlights(first, 3);
  await expectSearchHighlights(second, 2);
  await first.getByRole('textbox', { name: 'Search' }).press('Escape');
  await expectSearchHighlights(first, 0);
  await expectSearchHighlights(second, 2);
  await first.focus();
  await page.keyboard.press('ControlOrMeta+f');
  await first.getByRole('textbox', { name: 'Search' }).fill('target');
  await expectSearchHighlights(first, 3);
  await page.evaluate(() => window.__codeView?.reset());
  await expectSearchHighlights(first, 0);
  await expectSearchHighlights(second, 2);
  await second.getByRole('textbox', { name: 'Search' }).press('Escape');
  expect(
    await page.evaluate(() =>
      [...CSS.highlights.values()].reduce(
        (total, highlight) => total + highlight.size,
        0
      )
    )
  ).toBe(0);
});

for (const kind of ['file', 'split', 'unified'] as const) {
  test(`replace all while recycled renders current text and undo in ${kind}`, async ({
    page,
  }) => {
    await page.goto(
      `/test/e2e/fixtures/code-view-search.html?recycle&kind=${kind}&diffStyle=${kind}`
    );
    const root = page.locator('[data-code-view-root]');
    const content = root.locator('[contenteditable="true"]');
    await content
      .locator('[data-line="1"]:not([data-line-type="change-deletion"])')
      .click();
    await page.keyboard.press('ControlOrMeta+Alt+f');
    const panel = root.locator('[data-search-panel-overlay]');
    const search = panel.getByRole('textbox', { name: 'Search' });
    const replacement = panel.getByRole('textbox', {
      name: 'Replace',
      exact: true,
    });
    await expect(search).toBeVisible();
    await search.fill('target');
    await replacement.fill('NEW');
    await root.hover();
    await page.mouse.wheel(0, 6000);
    await expect(content).toHaveCount(0);
    await expect(replacement).toBeFocused();
    await panel
      .getByRole('button', { name: 'Replace All', exact: true })
      .click();
    await expect(panel.locator('[data-matches]')).toHaveText('No results');
    await expect
      .poll(() =>
        page.evaluate(() => window.__codeView?.getEditor('item')?.getText())
      )
      .toBe('NEW one\nkeep\nNEW two\n');
    await page.evaluate(() =>
      window.__codeView?.scrollTo({
        type: 'position',
        position: 0,
        behavior: 'instant',
      })
    );
    const rows = content.locator(
      '[data-line]:not([data-line-type="change-deletion"])'
    );
    await expect(rows.filter({ hasText: 'NEW' })).toHaveText([
      'NEW one',
      'NEW two',
    ]);
    await expect(content).not.toContainText('target');
    await expectSearchHighlights(root, 0);
    await root.hover();
    await page.mouse.wheel(0, 6000);
    await expect(content).toHaveCount(0);
    await page.evaluate(() => window.__codeView?.getEditor('item')?.undo());
    await expect
      .poll(() =>
        page.evaluate(() => window.__codeView?.getEditor('item')?.canUndo)
      )
      .toBe(false);
    await page.evaluate(() =>
      window.__codeView?.scrollTo({
        type: 'position',
        position: 0,
        behavior: 'instant',
      })
    );
    await expect(rows.filter({ hasText: 'target' })).toHaveText([
      'target one',
      'target two',
    ]);
    await expect(panel.locator('[data-matches]')).toContainText('2');
    await expectSearchHighlights(content, 2);
  });
}

test('ending edit mode with replacement input focused leaves find usable', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/code-view-search.html?scope');
  const root = page.locator('[data-code-view-root]');
  await root.locator('[contenteditable="true"]').nth(1).click();
  await page.keyboard.press('ControlOrMeta+Alt+f');
  const panel = root.locator('[data-search-panel-overlay]');
  const search = panel.getByRole('textbox', { name: 'Search' });
  const replacement = panel.getByRole('textbox', {
    name: 'Replace',
    exact: true,
  });
  await search.fill('target');
  await replacement.fill('NEW');
  await expect(replacement).toBeFocused();
  await page.evaluate(() => {
    const view = window.__codeView!;
    view.updateItem({ ...view.getItem('second')!, edit: false, version: 1 });
  });
  await expect(replacement).toBeHidden();
  await expect(panel.locator('[data-matches]')).toContainText('5');
  await search.click();
  await expect(search).toBeFocused();
  await search.fill('readonly');
  await expect(panel.locator('[data-matches]')).toHaveText('1 of 1');
});

for (const diffStyle of ['split', 'unified'] as const) {
  test(`scoped search reveals collapsed context without changing selections in ${diffStyle} mode`, async ({
    page,
  }) => {
    await page.goto(
      `/test/e2e/fixtures/code-view-search.html?collapsed&diffStyle=${diffStyle}`
    );
    const root = page.locator('[data-code-view-root]');
    const content = root.locator('[contenteditable="true"]');
    const hiddenLine = content.locator(
      '[data-line="101"]:not([data-line-type="change-deletion"])'
    );
    await expect(hiddenLine).toHaveCount(0);
    await content
      .locator('[data-line="10"]:not([data-line-type="change-deletion"])')
      .click();
    const selected = await page.evaluate(
      () => window.__codeView?.getEditor('diff')?.getViewState().selections
    );
    await page.keyboard.press('ControlOrMeta+f');
    const input = root.getByRole('textbox', { name: 'Search' });
    await input.fill('target');
    await expect(root.locator('[data-matches]')).toHaveText('1 of 1');
    await expect(hiddenLine).toBeInViewport();
    await expect(input).toBeFocused();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__codeView?.getEditor('diff')?.getViewState().selections
        )
      )
      .toEqual(selected);
    await expect(content.locator('[data-line="210"]')).toHaveCount(0);
    await input.press('Enter');
    await expect(hiddenLine).toBeInViewport();
    await expect(input).toBeFocused();

    const replacement = root.getByRole('textbox', {
      name: 'Replace',
      exact: true,
    });
    await replacement.fill('changed');
    await replacement.press('Enter');
    await expect(hiddenLine).toContainText('hidden changed');
    await expect(root.locator('[data-matches]')).toHaveText('No results');
    await expect(replacement).toBeFocused();
    await page.evaluate(() => window.__codeView?.getEditor('diff')?.undo());
    await expect(hiddenLine).toContainText('hidden target');
    await expect(root.locator('[data-matches]')).toContainText('1');
  });
}

test('search scope follows focus across editors, the panel, and outside CodeView', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/code-view-search.html?scope');
  const root = page.locator('[data-code-view-root]');
  const editors = root.locator('[contenteditable="true"]');
  const first = editors.nth(0);
  const second = editors.nth(1);
  await first.click();
  await expect(root.locator('[data-search-panel]')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+f');
  const panel = root.locator('[data-search-panel-overlay]');
  const input = panel.getByRole('textbox', { name: 'Search' });
  const count = panel.locator('[data-matches]');
  const replacement = panel.getByRole('textbox', {
    name: 'Replace',
    exact: true,
  });
  await expect(replacement).toBeVisible();
  await replacement.fill('changed');
  await input.fill('target');
  await expect(count).toHaveText('1 of 1');
  await expectSearchHighlights(root.locator('[data-deletions]'), 0);

  await second.click();
  await expect(count).toHaveText('2 results');
  await expect(second).toBeFocused();
  await expect(replacement).toHaveValue('changed');
  const matchCase = panel.getByRole('button', { name: 'Match Case' });
  await matchCase.click();
  await expect(matchCase).toHaveAttribute('aria-pressed', 'true');
  await expect(count).toContainText('of 2');
  await input.click();
  await page.keyboard.press('ControlOrMeta+f');
  await input.press('Enter');
  await expect(count).toContainText('of 2');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('target');

  await page.locator('[data-outside]').click();
  await expect(count).toContainText('of 5');
  await expectSearchHighlights(root.locator('[data-deletions]'), 1);
  await expect(page.locator('[data-outside]')).toBeFocused();
  await expect(replacement).toBeHidden();
  await expect(matchCase).toHaveAttribute('aria-pressed', 'true');
  await first.click();
  await expect(count).toHaveText('1 results');
  await expectSearchHighlights(root.locator('[data-deletions]'), 0);
  await expect(first).toBeFocused();
  await expect(replacement).toBeVisible();
  await expect(replacement).toHaveValue('changed');

  await root.focus();
  await page.keyboard.press('ControlOrMeta+f');
  await expect(count).toHaveText('5 results');
  await expect(replacement).toBeHidden();
  await expect(input).toHaveValue('target');
  await expect(root.getByRole('textbox', { name: 'Search' })).toHaveCount(1);
  await input.press('Escape');
  await first.click();
  await expect(root.locator('[data-search-panel]')).toHaveCount(0);
});

test('scoped replacement advances past inserted matches and replace all is one undo step', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/code-view-search.html?scope');
  const root = page.locator('[data-code-view-root]');
  const content = root.locator('[contenteditable="true"]').nth(1);
  await expect(content).toBeVisible();
  await page.evaluate(() =>
    window.__codeView?.getEditor('second')?.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 13 },
        },
        newText: 'target target target',
      },
    ])
  );
  await expect(content).toContainText('target target target');
  await content.click();
  await page.keyboard.press('ControlOrMeta+Alt+f');
  const panel = root.locator('[data-search-panel-overlay]');
  const input = panel.getByRole('textbox', { name: 'Search' });
  const replacement = panel.getByRole('textbox', {
    name: 'Replace',
    exact: true,
  });
  const count = panel.locator('[data-matches]');
  await input.fill('target');
  await input.press('Enter');
  await expect(count).toHaveText('2 of 3');
  await replacement.fill('targettarget');
  await replacement.press('Enter');
  await expect(content).toContainText('target targettarget target');
  await expect(count).toHaveText('4 of 4');
  await expect(replacement).toBeFocused();
  await replacement.press('Enter');
  await expect(content).toContainText('target targettarget targettarget');
  await expect(count).toHaveText('5 results');
  await replacement.fill('new');
  await panel.getByRole('button', { name: 'Replace All', exact: true }).click();
  await expect(content).toContainText('new newnew newnew');
  await expect(count).toHaveText('No results');
  await expectSearchHighlights(root, 0);
  await expect
    .poll(() =>
      page.evaluate(() => window.__codeView?.getEditor('diff')?.getText())
    )
    .toBe('target added\nunchanged\n');
  await page.evaluate(() => window.__codeView?.getEditor('second')?.undo());
  await expect(content).toContainText('target targettarget targettarget');
  await expect(count).toContainText('5');
  await expectSearchHighlights(content, 5);
});

test('unified edit highlights survive the delayed diff refresh', async ({
  page,
}) => {
  await page.goto(
    '/test/e2e/fixtures/code-view-search.html?recycle&diffStyle=unified'
  );
  const root = page.locator('[data-code-view-root]');
  const content = root.locator('[contenteditable="true"]');
  await content.focus();
  await page.keyboard.press('ControlOrMeta+f');
  await root.getByRole('textbox', { name: 'Search' }).fill('target');
  await expect(root.locator('[data-matches]')).toHaveText('1 of 2');
  const line = content.locator(
    '[data-line="1"]:not([data-line-type="change-deletion"])'
  );
  await line.click();
  await page.keyboard.press('Home');
  await page.keyboard.type('X');
  await expect(line).toContainText('Xtarget');
  const editedRow = await line.elementHandle();
  try {
    await expect
      .poll(() => editedRow!.evaluate((row) => row.isConnected))
      .toBe(false);
    await expect
      .poll(() =>
        page.evaluate(() =>
          [
            ...CSS.highlights.get('diffs-search-match')!,
            ...CSS.highlights.get('diffs-search-current')!,
          ].map((range) => (range as Range).toString())
        )
      )
      .toEqual(['target', 'target']);
  } finally {
    await editedRow?.dispose();
  }
});

for (const kind of ['file', 'split', 'unified']) {
  test(`edit highlights survive background retokenization in ${kind}`, async ({
    page,
  }) => {
    await page.goto(
      `/test/e2e/fixtures/code-view-search.html?retokenize&edit&kind=${kind}&diffStyle=${kind}`
    );
    const root = page.locator('[data-code-view-root]');
    await root.locator('[contenteditable="true"]').focus();
    await page.keyboard.press('ControlOrMeta+f');
    const input = root.getByRole('textbox', { name: 'Search' });
    await input.fill('target');
    await expectSearchHighlights(root, 3);
    const rendered = await page.evaluateHandle(() => {
      const view = window.__codeView!;
      const { options } = view as unknown as {
        options: CodeViewOptions<undefined, undefined>;
      };
      view.setOptions({ ...options, themeType: 'light' });
      view.render(true);
      const row = document
        .querySelector('diffs-container')!
        .shadowRoot!.querySelector(
          '[contenteditable="true"] [data-line="1"]:not([data-line-type="change-deletion"])'
        )!;
      return { row, text: row.firstChild! };
    });
    try {
      await expect
        .poll(() => rendered.evaluate(({ text }) => text.isConnected))
        .toBe(false);
      expect(await rendered.evaluate(({ row }) => row.isConnected)).toBe(true);
      await expectSearchHighlights(root, 3);
      await expect
        .poll(() =>
          page.evaluate(() =>
            [
              ...CSS.highlights.get('diffs-search-match')!,
              ...CSS.highlights.get('diffs-search-current')!,
            ].map((range) => (range as Range).toString())
          )
        )
        .toEqual(['target', 'target', 'target']);
      await expect(input).toBeFocused();
    } finally {
      await rendered.dispose();
    }
  });
}

test('refreshes search after typing and undo without a host update', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/code-view-search.html');
  const root = page.locator('[data-code-view-root]');
  const content = root.locator('[contenteditable="true"]');
  await content.click();
  await page.keyboard.press('ControlOrMeta+f');
  const panel = root.locator('[data-search-panel-overlay]');
  await panel.getByRole('textbox', { name: 'Search' }).fill('github');
  await expect(panel.locator('[data-matches]')).toHaveText('1 of 4');

  const line = content.locator('[data-line="125"]');
  await line.click();
  await page.keyboard.press('Home');
  await page.keyboard.type('github ');
  await expect(panel.locator('[data-matches]')).toContainText('5');
  await expectSearchHighlights(line, 2);
  await expect(content).toBeFocused();

  await page.keyboard.press('ControlOrMeta+z');
  await expect(panel.locator('[data-matches]')).toContainText('4');
  await expectSearchHighlights(line, 1);
});

test('find from an editable CodeView uses its panel and reaches offscreen matches', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/code-view-search.html');
  const root = page.locator('[data-code-view-root]');
  const content = root.locator('[contenteditable="true"]');
  await content.click();
  const selected = await page.evaluate(
    () => window.__codeView?.getEditor('file')?.getViewState().selections
  );
  await page.keyboard.press('ControlOrMeta+f');

  const panel = root.locator('[data-search-panel-overlay]');
  const input = panel.getByRole('textbox', { name: 'Search' });
  await expect(input).toBeFocused();
  await expect(root.getByRole('textbox', { name: 'Search' })).toHaveCount(1);
  await input.fill('github');
  await expect(panel.locator('[data-matches]')).toHaveText('1 of 4');
  for (let match = 2; match <= 4; match++) {
    await input.press('Enter');
    await expect(panel.locator('[data-matches]')).toHaveText(`${match} of 4`);
  }

  const line201 = content.locator('[data-line="201"]');
  await expect(line201).toBeInViewport();
  await expect(input).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__codeView?.getEditor('file')?.getViewState().selections
      )
    )
    .toEqual(selected);

  // Returning focus to an editor must keep find-again on the CodeView panel.
  await line201.click();
  await page.keyboard.press('ControlOrMeta+Shift+g');
  await expect(panel.locator('[data-matches]')).toHaveText('3 of 4');
  await expect(content.locator('[data-line="128"]')).toBeInViewport();
  await page.keyboard.press('ControlOrMeta+g');
  await expect(panel.locator('[data-matches]')).toHaveText('4 of 4');
  await expect(line201).toBeInViewport();

  // User scrolling must remain usable after visiting the offscreen match.
  await root.hover();
  await page.mouse.wheel(0, 2000);
  await expect(line201).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+f');
  await expect(input).toBeFocused();
  await input.press('Enter');
  await expect(panel.locator('[data-matches]')).toHaveText('1 of 4');
  await expect(content.locator('[data-line="125"]')).toBeInViewport();

  await content.locator('[data-line="125"]').click();
  await page.keyboard.press('Escape');
  await expect(root.locator('[data-search-panel]')).toHaveCount(0);
  await page.keyboard.type('typed');
  await expect(content).toContainText('typed');
});

for (const kind of ['file', 'split', 'unified'] as const) {
  for (const edit of [false, true]) {
    test(`find preserves the viewport until the first scroll, then centers navigation in ${kind} ${edit ? 'edit' : 'readonly'}`, async ({
      page,
    }) => {
      await page.goto(
        `/test/e2e/fixtures/code-view-search.html?viewport&kind=${kind}&diffStyle=${kind}${edit ? '&edit' : ''}`
      );
      const root = page.locator('[data-code-view-root]');
      const row = (line: number) =>
        root.locator(
          `[data-line="${line}"]:not([data-line-type="change-deletion"])`
        );
      const expectCentered = (line: number) =>
        expect
          .poll(() =>
            row(line).evaluate((element) => {
              const viewport = document
                .querySelector('[data-code-view-root]')!
                .getBoundingClientRect();
              const rect = element.getBoundingClientRect();
              return Math.abs(
                (rect.top + rect.bottom) / 2 -
                  (viewport.top + viewport.bottom) / 2
              );
            })
          )
          .toBeLessThan(2);
      const offsetViewport = async () => {
        const position = await page.evaluate(() => {
          const position =
            document.querySelector('[data-code-view-root]')!.scrollTop + 12;
          window.__codeView!.scrollTo({
            type: 'position',
            position,
            behavior: 'instant',
          });
          return position;
        });
        await expect
          .poll(() => root.evaluate((element) => element.scrollTop))
          .toBe(position);
      };
      await page.evaluate(() =>
        window.__codeView?.scrollTo({
          type: 'line',
          id: 'item',
          lineNumber: 90,
          align: 'start',
          behavior: 'instant',
        })
      );
      await expect(row(100)).toBeInViewport();
      await expect(row(101)).toBeInViewport();
      await expect(row(20)).not.toBeInViewport();
      if (edit) {
        await page.evaluate(() => {
          const editor = window.__codeView?.getEditor('item');
          editor?.setSelections(
            [
              {
                start: { line: 100, character: 1 },
                end: { line: 100, character: 1 },
                direction: 'none',
              },
            ],
            { skipScrollAndFocus: true }
          );
          editor?.focus({ preventScroll: true });
        });
      } else {
        await root.focus();
      }
      await expect(row(100)).toBeInViewport();
      await expect(row(20)).not.toBeInViewport();
      const selected = await page.evaluate(
        () => window.__codeView?.getEditor('item')?.getViewState().selections
      );
      const scrollTop = await root.evaluate((element) => element.scrollTop);
      await page.keyboard.press('ControlOrMeta+f');
      const input = root.getByRole('textbox', { name: 'Search' });
      await input.fill('target');
      await expect(root.locator('[data-matches]')).toHaveText('2 of 4');
      await expect
        .poll(() => root.evaluate((element) => element.scrollTop))
        .toBe(scrollTop);
      await input.press('Enter');
      await expect(root.locator('[data-matches]')).toHaveText('3 of 4');
      expect(await root.evaluate((element) => element.scrollTop)).toBe(
        scrollTop
      );
      await input.press('Enter');
      await expect(root.locator('[data-matches]')).toHaveText('4 of 4');
      await expectCentered(161);
      await input.press('Shift+Enter');
      await expect(root.locator('[data-matches]')).toHaveText('3 of 4');
      await expectCentered(101);
      if (edit) {
        await page.evaluate(() =>
          window.__codeView!.getEditor('item')!.applyEdits([
            {
              range: {
                start: { line: 190, character: 0 },
                end: { line: 190, character: 0 },
              },
              newText: 'target ',
            },
          ])
        );
        await expect(root.locator('[data-matches]')).toHaveText('3 of 5');
        await page.evaluate(() => window.__codeView!.getEditor('item')!.undo());
        await expect(root.locator('[data-matches]')).toHaveText('3 of 4');
      }
      // These adjacent results are already visible, but centering now persists
      // in both directions and through background match refreshes.
      await input.press('Shift+Enter');
      await expectCentered(100);
      await input.press('Enter');
      await expectCentered(101);
      await input.press('Enter');
      await expectCentered(161);
      await offsetViewport();
      const centeredScroll = await root.evaluate(
        (element) => element.scrollTop
      );
      if (edit) {
        await root
          .getByRole('textbox', { name: 'Replace', exact: true })
          .fill('new');
        await expect(root.locator('[data-matches]')).toHaveText('4 of 4');
        expect(await root.evaluate((element) => element.scrollTop)).toBe(
          centeredScroll
        );
      }
      // A fresh query stays on the first visible result, even with earlier hits.
      await input.fill('TARGET');
      await expect(root.locator('[data-matches]')).toHaveText('4 of 4');
      expect(await root.evaluate((element) => element.scrollTop)).toBe(
        centeredScroll
      );
      await input.press('Enter');
      await expect(root.locator('[data-matches]')).toHaveText('1 of 4');
      await expectCentered(20);
      await expect
        .poll(() => root.evaluate((element) => element.scrollTop))
        .toBeLessThan(centeredScroll);
      await input.press('Shift+Enter');
      await expect(root.locator('[data-matches]')).toHaveText('4 of 4');
      await expectCentered(161);
      await offsetViewport();
      const beforeOption = await root.evaluate((element) => element.scrollTop);
      await root
        .getByRole('button', { name: 'Whole Word', exact: true })
        .click();
      await expect(root.locator('[data-matches]')).toHaveText('4 of 4');
      expect(await root.evaluate((element) => element.scrollTop)).toBe(
        beforeOption
      );
      expect(
        await page.evaluate(
          () => window.__codeView?.getEditor('item')?.getViewState().selections
        )
      ).toEqual(selected);
    });
  }
}

for (const kind of ['file', 'split', 'unified'] as const) {
  for (const edit of [false, true]) {
    test(`initial search moves after the mounted range before wrapping in ${kind} ${edit ? 'edit' : 'readonly'}`, async ({
      page,
    }) => {
      await page.goto(
        `/test/e2e/fixtures/code-view-search.html?candidates&kind=${kind}&diffStyle=${kind}${edit ? '&edit' : ''}`
      );
      const root = page.locator('[data-code-view-root]');
      const row = (line: number) =>
        root.locator(
          `[data-line="${line}"]:not([data-line-type="change-deletion"])`
        );
      const prepare = async (line: number) => {
        await page.evaluate(
          (line) =>
            window.__codeView?.scrollTo({
              type: 'line',
              id: 'item',
              lineNumber: line,
              align: 'start',
              behavior: 'instant',
            }),
          line
        );
        await expect(row(line)).toBeInViewport();
        if (edit) {
          await page.evaluate((line) => {
            const editor = window.__codeView?.getEditor('item');
            editor?.setSelections(
              [
                {
                  start: { line: line - 1, character: 0 },
                  end: { line: line - 1, character: 0 },
                  direction: 'none',
                },
              ],
              { skipScrollAndFocus: true }
            );
            editor?.focus({ preventScroll: true });
          }, line);
        } else await root.focus();
      };
      await prepare(500);
      await expect(row(10)).toHaveCount(0);
      await expect(row(1000)).toHaveCount(0);
      await page.keyboard.press('ControlOrMeta+f');
      let input = root.getByRole('textbox', { name: 'Search' });
      await input.fill('target');
      await expect(root.locator('[data-matches]')).toHaveText('2 of 3');
      await expect(row(1000)).toBeInViewport();
      await input.press('Escape');
      // A mounted overscan hit wins over the later unmounted hit.
      await prepare(1002);
      await expect(row(1000)).toHaveCount(1);
      await expect(row(1000)).not.toBeInViewport();
      await page.keyboard.press('ControlOrMeta+f');
      input = root.getByRole('textbox', { name: 'Search' });
      await input.fill('target');
      await expect(root.locator('[data-matches]')).toHaveText('2 of 3');
      await expect(row(1000)).toBeInViewport();
      await input.press('Escape');
      await prepare(2800);
      await expect(row(1800)).toHaveCount(0);
      await page.keyboard.press('ControlOrMeta+f');
      input = root.getByRole('textbox', { name: 'Search' });
      await input.fill('target');
      await expect(root.locator('[data-matches]')).toHaveText('1 of 3');
      await expect(row(10)).toBeInViewport();
    });
  }
}

for (const kind of ['file', 'split', 'unified']) {
  for (const edit of [false, true]) {
    test(`highlight repaint only prepares mounted matches in dense ${kind} ${edit ? 'edit' : 'readonly'}`, async ({
      page,
    }) => {
      await page.goto(
        `/test/e2e/fixtures/code-view-search.html?dense&kind=${kind}&diffStyle=${kind}${edit ? '&edit' : ''}`
      );
      const root = page.locator('[data-code-view-root]');
      if (edit) await root.locator('[contenteditable="true"]').focus();
      else await root.focus();
      await page.keyboard.press('ControlOrMeta+f');
      await root.getByRole('textbox', { name: 'Search' }).fill('target');
      await expect(root.locator('[data-matches]')).toHaveText(/\d+ of \d{5}/);

      const measureRepaint = () =>
        page.evaluate(() => {
          const view = window.__codeView as unknown as {
            searchState: { matches: { endCharacter: number }[] };
            paintSearchHighlights(): void;
          };
          let reads = 0;
          const matches = view.searchState.matches;
          const ends = matches.map((match) => match.endCharacter);
          try {
            for (const [index, match] of matches.entries()) {
              Object.defineProperty(match, 'endCharacter', {
                configurable: true,
                get: () => {
                  reads++;
                  return ends[index];
                },
              });
            }
            view.paintSearchHighlights();
            const ranges = [
              ...CSS.highlights.get('diffs-search-match')!,
              ...CSS.highlights.get('diffs-search-current')!,
            ] as Range[];
            return {
              reads,
              painted: ranges.length,
              matches: matches.length,
              correctText: ranges.every(
                (range) => range.toString() === 'target'
              ),
            };
          } finally {
            for (const [index, match] of matches.entries()) {
              Object.defineProperty(match, 'endCharacter', {
                configurable: true,
                writable: true,
                value: ends[index],
              });
            }
          }
        });

      for (const lineNumber of [1, 6000, 1]) {
        await page.evaluate(
          (lineNumber) =>
            window.__codeView!.scrollTo({
              type: 'line',
              id: 'item',
              lineNumber,
              align: 'center',
              behavior: 'instant',
            }),
          lineNumber
        );
        await expect
          .poll(() =>
            page.evaluate(
              (lineNumber) =>
                [
                  ...CSS.highlights.get('diffs-search-match')!,
                  ...CSS.highlights.get('diffs-search-current')!,
                ].some(
                  (range) =>
                    Number(
                      (range as Range).startContainer.parentElement
                        ?.closest('[data-line]')
                        ?.getAttribute('data-line')
                    ) === lineNumber
                ),
              lineNumber
            )
          )
          .toBe(true);
        const result = await measureRepaint();
        expect(result.matches).toBeGreaterThanOrEqual(10000);
        expect(result.painted).toBeGreaterThan(0);
        expect(result.painted).toBeLessThan(500);
        expect(result.correctText).toBe(true);
        expect(result.reads).toBeLessThanOrEqual(result.painted + 2);
      }
    });
  }
}

for (const diffStyle of ['split', 'unified']) {
  test(`collapsed hits stay searchable without becoming rendered candidates in ${diffStyle}`, async ({
    page,
  }) => {
    await page.goto(
      `/test/e2e/fixtures/code-view-search.html?collapsed&many&diffStyle=${diffStyle}`
    );
    const root = page.locator('[data-code-view-root]');
    const content = root.locator('[contenteditable="true"]');
    await expect(content).toBeVisible();
    await content.focus();
    const rows = content.locator(
      '[data-line][data-line-type]:not([data-line-type="change-deletion"])'
    );
    const rowCount = await rows.count();
    expect(rowCount).toBeLessThan(100);
    const firstVisibleLine = await rows.evaluateAll((rows) => {
      const viewport = document
        .querySelector('[data-code-view-root]')!
        .getBoundingClientRect();
      const row = rows.find((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
      });
      return Number(row?.getAttribute('data-line'));
    });
    expect(firstVisibleLine).toBeGreaterThan(1);
    await page.keyboard.press('ControlOrMeta+f');
    await root.getByRole('textbox', { name: 'Search' }).fill('target');
    await expect(root.locator('[data-matches]')).toHaveText(
      `${firstVisibleLine} of 10000`
    );
    await expect(rows).toHaveCount(rowCount);
    expect(
      await page.evaluate(() => {
        const range = [
          ...CSS.highlights.get('diffs-search-current')!,
        ][0] as Range;
        return Number(
          range.startContainer.parentElement
            ?.closest('[data-line]')
            ?.getAttribute('data-line')
        );
      })
    ).toBe(firstVisibleLine);
  });
}
