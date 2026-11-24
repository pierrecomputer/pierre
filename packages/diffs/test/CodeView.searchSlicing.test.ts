import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { i18n } from '../src/i18n/I18n';
import {
  CodeViewSearchScan,
  MAX_SEARCH_MATCHES,
  type SearchPanelState,
} from '../src/search';
import type { CodeViewItem } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  fillReplace,
  fillSearch,
  getEditorContent,
  getRenderedSearchMatches,
  getSearchPanelRoot,
  getSearchState,
  pressSearchEnter,
  replaceFromPanel,
} from './codeViewSearchHarness';
import {
  createRoot,
  installDom,
  renderItems,
  wait,
  waitFor,
} from './domHarness';

beforeAll(async () => {
  await getSharedHighlighter({
    themes: ['pierre-dark', 'pierre-light'],
    langs: ['text'],
    preferredHighlighter: 'shiki-js',
  });
});
afterAll(disposeHighlighter);

// Each large item crosses multiple clock boundaries without needing huge fixtures.
function fileItem(
  id: string,
  contents = `target ${'x'.repeat(80)}\n`.repeat(2000),
  edit = false
): CodeViewItem<undefined> {
  return { id, type: 'file', edit, file: { name: `${id}.txt`, contents } };
}

// Controls only time; real browser messages, rendering, editors and walkers still run.
async function withViewer(
  items: CodeViewItem<undefined>[],
  run: (context: {
    viewer: CodeView;
    root: HTMLElement;
    states: SearchPanelState[];
    finish(): Promise<void>;
  }) => void | Promise<void>,
  options: {
    diffStyle?: 'split' | 'unified';
    tokenizeMaxLineLength?: number;
  } = {}
): Promise<void> {
  const dom = installDom();
  const states: SearchPanelState[] = [];
  const viewer = new CodeView({
    ...options,
    useTokenTransformer: true,
    createEditor: (type, settings, key) => new Editor(type, settings, key),
    onSearchStateChange: (state) => {
      if (state != null) states.push(state);
    },
  });
  let ticks = 0;
  const clock = spyOn(performance, 'now');
  try {
    clock.mockReturnValue(0);
    const root = createRoot();
    viewer.setup(root);
    await renderItems(viewer, items);
    viewer.openSearch({ query: '', scope: 'all' });
    await wait(0);
    clock.mockImplementation(() => (ticks += 2));
    await run({
      viewer,
      root,
      states,
      finish: async () => {
        viewer.render(true);
        await waitFor(() => states.at(-1)?.searching === false, {
          timeout: 10000,
        });
        expect(states.at(-1)?.searching).toBe(false);
      },
    });
  } finally {
    clock.mockRestore();
    viewer.cleanUp();
    dom.cleanup();
  }
}

// The result count labels are inside the panel's shadow root.
function matches(root: HTMLElement): HTMLElement | null {
  return getSearchPanelRoot(root).querySelector('[data-matches]');
}

function label(root: HTMLElement): string | null | undefined {
  return matches(root)?.textContent;
}

describe('CodeView sliced find', () => {
  const diffStyles: ('split' | 'unified')[] = ['split', 'unified'];
  for (const diffStyle of diffStyles) {
    test(`${diffStyle} files, diffs and edited items equal an unsliced scan and publish monotonic counts`, async () => {
      const before = `target old ${'x'.repeat(80)}\n`.repeat(2000);
      const after = before.replaceAll('old', 'new');
      const fileDiff = parseDiffFromFile(
        { name: 'd.txt', contents: before },
        { name: 'd.txt', contents: after }
      );
      const items: CodeViewItem<undefined>[] = [
        fileItem('edited', undefined, true),
        { id: 'diff', type: 'diff', fileDiff, edit: true },
        fileItem('file'),
      ];
      await withViewer(
        items,
        async ({ viewer, root, states, finish }) => {
          for (const id of ['edited', 'diff']) {
            viewer.scrollTo({
              type: 'item',
              id,
              align: 'start',
              behavior: 'instant',
            });
            viewer.render(true);
            await wait(0);
            const editor = viewer.getEditor(id);
            if (editor == null) throw new Error(`Missing editor ${id}`);
            editor.applyEdits([
              {
                range: {
                  start: { line: 0, character: 7 },
                  end: { line: 0, character: 7 },
                },
                newText: 'edited ',
              },
            ]);
          }
          viewer.scrollTo({
            type: 'position',
            position: 0,
            behavior: 'instant',
          });
          viewer.render(true);
          await wait(0);
          fillSearch(root, 'target');
          expect(states.at(-1)?.searching).toBe(true);
          expect(matches(root)?.ariaLabel).toBe('Searching…');
          expect(
            matches(root)?.querySelector('use')?.getAttribute('href')
          ).toBe('#diffs-editor-icon-loader');
          await finish();
          const scan = new CodeViewSearchScan(
            {
              text: 'target',
              replaceText: '',
              caseSensitive: false,
              regex: false,
              wholeWord: false,
            },
            items.length,
            (position) => {
              const id = items[position].id;
              const item = viewer.getItem(id);
              if (item == null) throw new Error(`Missing item ${id}`);
              const contents = viewer.getEditor(id)?.getText();
              return item.type === 'diff'
                ? {
                    itemId: id,
                    type: 'diff',
                    fileDiff,
                    additionContents: contents,
                    diffStyle,
                    additionsOnly: false,
                  }
                : {
                    itemId: id,
                    type: 'file',
                    contents: contents ?? item.file.contents,
                  };
            },
            MAX_SEARCH_MATCHES
          );
          scan.advance();
          expect(getSearchState(viewer).matches).toEqual(scan.getMatches());
          const counts = states
            .filter(({ text }) => text === 'target')
            .map(({ matchCount }) => matchCount);
          expect(counts).toEqual([...counts].sort((a, b) => a - b));
          expect(matches(root)?.hasAttribute('data-searching')).toBe(false);
          expect(label(root)).toContain(i18n.formatNumber(counts.at(-1) ?? 0));
          expect(
            states.filter(
              ({ text, searching, matchCount }) =>
                text === 'target' && searching && matchCount === 0
            ).length
          ).toBeGreaterThan(0);
        },
        { diffStyle }
      );
    });
  }

  test('visible item completes in the query call and next uses partial results without waiting', async () => {
    await withViewer(
      [
        fileItem('visible', `target target\n${'blank\n'.repeat(200)}`),
        fileItem('later'),
      ],
      async ({ viewer, root, states, finish }) => {
        fillSearch(root, 'target');
        expect(states.at(-1)?.searching).toBe(true);
        expect(getSearchState(viewer).matches).toHaveLength(2);
        expect(getSearchState(viewer).current?.itemId).toBe('visible');
        expect(
          getRenderedSearchMatches(root).map((range) => range.toString())
        ).toEqual(['target', 'target']);
        const before = states.at(-1)?.matchCount;
        viewer.navigateSearch('next');
        expect(states.at(-1)?.searching).toBe(true);
        expect(states.at(-1)?.matchCount).toBe(before);
        expect(getSearchState(viewer).current?.startCharacter).toBe(7);
        await finish();
        expect(getSearchState(viewer).current?.startCharacter).toBe(7);
      }
    );
  });

  test('late first match pays its query jump once', async () => {
    await withViewer(
      [
        fileItem('first', `blank ${'x'.repeat(80)}\n`.repeat(2000)),
        fileItem('later'),
      ],
      async ({ viewer, root, finish }) => {
        fillSearch(root, 'target');
        expect(getSearchState(viewer).current).toBeUndefined();
        await finish();
        expect(getSearchState(viewer).current?.itemId).toBe('later');
        const current = getSearchState(viewer).current;
        viewer.render(true);
        await wait(0);
        expect(getSearchState(viewer).current).toEqual(current);
      }
    );
  });

  test('next before any matches keeps the owed query jump', async () => {
    await withViewer([fileItem('later')], async ({ viewer, root, finish }) => {
      fillSearch(root, 'target');
      pressSearchEnter(root);
      await finish();
      expect(getSearchState(viewer).matches).toHaveLength(2000);
      expect(getSearchState(viewer).current?.itemId).toBe('later');
    });
  });

  test('a new query cancels unfinished work and only reports its own results', async () => {
    await withViewer(
      [fileItem('large')],
      async ({ viewer, root, states, finish }) => {
        fillSearch(root, 'target');
        fillSearch(root, 'missing');
        const start = states.length;
        await finish();
        expect(getSearchState(viewer).matches).toEqual([]);
        expect(label(root)).toBe('0/0');
        expect(
          states.slice(start).every(({ text }) => text === 'missing')
        ).toBe(true);
      }
    );
  });

  test('closing cancels unfinished work', async () => {
    await withViewer([fileItem('large')], async ({ viewer, root, states }) => {
      fillSearch(root, 'target');
      viewer.closeSearch();
      const count = states.length;
      await wait(20);
      expect(states).toHaveLength(count);
      expect(getSearchState(viewer).matches).toEqual([]);
    });
  });

  for (const mutation of ['add', 'remove', 'update', 'collapse']) {
    test(`${mutation} during a scan finishes with current items`, async () => {
      await withViewer(
        [fileItem('a'), fileItem('b')],
        async ({ viewer, root, finish }) => {
          fillSearch(root, 'target');
          if (mutation === 'add') viewer.addItems([fileItem('new', 'target')]);
          else if (mutation === 'remove') viewer.removeItem('b');
          else if (mutation === 'update')
            viewer.updateItem({ ...fileItem('b', 'missing'), version: 1 });
          else
            viewer.updateItem({
              ...fileItem('b'),
              collapsed: true,
              version: 1,
            });
          viewer.render(true);
          await finish();
          const expected =
            mutation === 'add' ? 4001 : mutation === 'collapse' ? 4000 : 2000;
          expect(getSearchState(viewer).matches).toHaveLength(expected);
        }
      );
    });
  }

  test('changing to editor scope cancels the global scan and blocks replace until finished', async () => {
    await withViewer(
      [fileItem('a', undefined, true), fileItem('b')],
      async ({ viewer, root, states, finish }) => {
        fillSearch(root, 'target');
        getEditorContent(viewer, 'a').focus();
        viewer.openSearch({
          query: 'target',
          scope: 'focused',
          mode: 'replace',
        });
        viewer.render(true);
        expect(states.at(-1)?.searching).toBe(true);
        const buttons = Array.from(
          getSearchPanelRoot(root).querySelectorAll<HTMLButtonElement>(
            '[data-replace-actions] button'
          )
        );
        expect(buttons).toHaveLength(2);
        expect(buttons.every(({ disabled }) => disabled)).toBe(true);
        fillReplace(root, 'new');
        replaceFromPanel(root);
        replaceFromPanel(root, true);
        expect(viewer.getEditor('a')?.getText().startsWith('target')).toBe(
          true
        );
        await finish();
        expect(getSearchState(viewer).matches).toHaveLength(2000);
        expect(buttons.every(({ disabled }) => !disabled)).toBe(true);
        viewer.navigateSearch('next');
        expect(getSearchState(viewer).current?.lineIndex).toBe(0);
        viewer.navigateSearch('next');
        expect(getSearchState(viewer).current?.lineIndex).toBe(1);
        replaceFromPanel(root);
        viewer.render(true);
        expect(states.at(-1)?.searching).toBe(true);
        expect(states.at(-1)?.currentMatchIndex).toBeUndefined();
        await finish();
        expect(getSearchState(viewer).current?.lineIndex).toBe(2);
        const document = viewer.getEditor('a')?.getEditState()?.document;
        expect(document?.getLineText(0).startsWith('target')).toBe(true);
        expect(document?.getLineText(1).startsWith('new')).toBe(true);
      }
    );
  });

  test('next before replacement results keeps the next-after-anchor jump', async () => {
    await withViewer(
      [fileItem('edit', undefined, true)],
      async ({ viewer, root, finish }) => {
        viewer.openSearch({
          query: 'target',
          scope: { itemId: 'edit' },
          mode: 'replace',
        });
        await finish();
        fillReplace(root, 'new');
        replaceFromPanel(root);
        expect(getSearchState(viewer).current?.startCharacter).toBe(
          getSearchState(viewer).current?.endCharacter
        );
        viewer.render(true);
        pressSearchEnter(root);
        await finish();
        expect(getSearchState(viewer).current?.lineIndex).toBe(1);
      }
    );
  });

  const partialDirections: ('next' | 'previous')[] = ['next', 'previous'];
  for (const direction of partialDirections) {
    test(`${direction} uses partial matches and cancels a still-owed query preference`, async () => {
      await withViewer(
        [fileItem('small', 'target target'), fileItem('large')],
        async ({ viewer, root, states, finish }) => {
          // The pending edge item now owns the starting choice; earlier partial
          // matches remain navigable without deciding that choice for the query.
          viewer.scrollTo({
            type: 'line',
            id: 'large',
            lineNumber: 1,
            align: 'start',
            behavior: 'instant',
          });
          viewer.render(true);
          await wait(0);
          fillSearch(root, 'target');
          expect(getSearchState(viewer).matches).toHaveLength(2);
          expect(getSearchState(viewer).current).toBeUndefined();
          viewer.navigateSearch(direction);
          expect(getSearchState(viewer).current?.startCharacter).toBe(
            direction === 'previous' ? 7 : 0
          );
          expect(states.at(-1)?.searching).toBe(true);
          await finish();
          expect(getSearchState(viewer).current?.startCharacter).toBe(
            direction === 'previous' ? 7 : 0
          );
        }
      );
    });
  }

  for (const direction of ['before', 'after', 'none']) {
    test(`starting match ${direction} the rendered items obeys certainty and navigates once`, async () => {
      const blank = `blank ${'x'.repeat(80)}\n`.repeat(2000);
      const items = [
        fileItem('before', direction === 'before' ? `target\n${blank}` : blank),
        fileItem('middle', blank),
        fileItem('after', direction === 'after' ? 'target' : blank),
      ];
      await withViewer(items, async ({ viewer, root, states, finish }) => {
        viewer.scrollTo({
          type: 'line',
          id: 'middle',
          lineNumber: 1000,
          align: 'start',
          behavior: 'instant',
        });
        viewer.render(true);
        await wait(0);
        expect(
          viewer.getRenderedItems().some(({ id }) => id === 'before')
        ).toBe(false);
        const initialTop = root.scrollTop;
        fillSearch(root, 'target');
        expect(getSearchState(viewer).current).toBeUndefined();
        if (direction === 'after') {
          await waitFor(
            () => getSearchState(viewer).current?.itemId === 'after'
          );
          expect(getSearchState(viewer).current?.itemId).toBe('after');
          expect(states.at(-1)?.searching).toBe(true);
          viewer.scrollTo({
            type: 'position',
            position: initialTop,
            behavior: 'instant',
          });
          viewer.render(true);
        }
        await finish();
        if (direction === 'after') expect(root.scrollTop).toBe(initialTop);
        if (direction === 'before') {
          expect(
            states
              .filter(({ text, searching }) => text === 'target' && searching)
              .every(({ currentMatchIndex }) => currentMatchIndex == null)
          ).toBe(true);
        }
        if (direction === 'none') {
          expect(getSearchState(viewer).current).toBeUndefined();
          expect(root.scrollTop).toBe(initialTop);
        } else {
          expect(getSearchState(viewer).current?.itemId).toBe(direction);
          const current = getSearchState(viewer).current;
          viewer.navigateSearch('next');
          viewer.render(true);
          await wait(0);
          expect(getSearchState(viewer).current).toEqual(current);
        }
      });
    });
  }

  test('a newly rendered pending item becomes current before the rest finishes', async () => {
    const blank = `blank ${'x'.repeat(80)}\n`.repeat(2000);
    await withViewer(
      [
        fileItem('before', `target\n${blank}`),
        fileItem('middle', blank),
        fileItem('after', 'target'),
        fileItem('later', blank),
      ],
      async ({ viewer, root, states, finish }) => {
        viewer.scrollTo({
          type: 'line',
          id: 'middle',
          lineNumber: 1000,
          align: 'center',
          behavior: 'instant',
        });
        viewer.render(true);
        await wait(0);
        fillSearch(root, 'target');
        expect(getSearchState(viewer).current).toBeUndefined();
        viewer.scrollTo({
          type: 'line',
          id: 'before',
          lineNumber: 1,
          align: 'center',
          behavior: 'instant',
        });
        viewer.render(true);
        await finish();
        expect(
          states.some(
            ({ searching, matchCount, currentMatchIndex }) =>
              searching && matchCount > 0 && currentMatchIndex === 0
          )
        ).toBe(true);
        expect(
          states
            .filter(
              ({ text, searching, matchCount }) =>
                text === 'target' && searching && matchCount === 0
            )
            .every(({ currentMatchIndex }) => currentMatchIndex == null)
        ).toBe(true);
        expect(getSearchState(viewer).current?.itemId).toBe('before');
      }
    );
  });

  test('scrolling within a pending item chooses the match currently in view', async () => {
    const lines = Array.from({ length: 2000 }, () => `blank ${'x'.repeat(80)}`);
    lines[0] = 'target';
    lines[1000] = 'target';
    await withViewer(
      [fileItem('item', lines.join('\n'))],
      async ({ viewer, root, finish }) => {
        fillSearch(root, 'target');
        expect(getSearchState(viewer).current).toBeUndefined();
        viewer.scrollTo({
          type: 'line',
          id: 'item',
          lineNumber: 1001,
          align: 'center',
          behavior: 'instant',
        });
        viewer.render(true);
        await finish();
        expect(getSearchState(viewer).current?.lineNumber).toBe(1001);
        // The match is on screen, so the next step moves on from it.
        viewer.navigateSearch('next');
        expect(getSearchState(viewer).current?.lineNumber).toBe(1);
      }
    );
  });

  for (const scroll of ['scrollTo', 'wheel']) {
    test(`a ${scroll} right after find opens with a query keeps the view and still selects the match`, async () => {
      const dom = installDom();
      const states: SearchPanelState[] = [];
      const viewer = new CodeView({
        useTokenTransformer: true,
        onSearchStateChange: (state) => {
          if (state != null) states.push(state);
        },
      });
      try {
        const root = createRoot();
        viewer.setup(root);
        const blank = `blank ${'x'.repeat(80)}\n`.repeat(4000);
        await renderItems(viewer, [fileItem('file', `target\n${blank}`)]);
        viewer.scrollTo({
          type: 'line',
          id: 'file',
          lineNumber: 1000,
          align: 'center',
          behavior: 'instant',
        });
        viewer.render(true);
        const scrollTop = viewer.getScrollTop();
        expect(scrollTop).toBeGreaterThan(0);

        // The first search runs a frame after find opens. The scroll lands
        // in between.
        viewer.openSearch({ query: 'target', scope: 'all' });
        if (scroll === 'wheel') {
          root.dispatchEvent(new Event('wheel', { bubbles: true }));
        } else {
          viewer.scrollTo({
            type: 'position',
            position: scrollTop,
            behavior: 'instant',
          });
        }
        await waitFor(
          () =>
            states.at(-1)?.matchCount === 1 &&
            states.at(-1)?.searching === false
        );
        await wait(20);
        expect(states.at(-1)?.currentMatchIndex).toBe(0);
        expect(label(root)).toBe('1/1');
        expect(viewer.getScrollTop()).toBe(scrollTop);
      } finally {
        viewer.cleanUp();
        dom.cleanup();
      }
    });
  }

  test('a pointer press in the find panel lets a smooth find scroll finish', async () => {
    const dom = installDom();
    const viewer = new CodeView({
      useTokenTransformer: true,
      searchOptions: { scrollBehavior: 'smooth' },
    });
    try {
      const root = createRoot();
      viewer.setup(root);
      const blank = `blank ${'x'.repeat(80)}\n`.repeat(2000);
      await renderItems(viewer, [
        fileItem('one', `target\n${blank}`),
        fileItem('two', `target\n${blank}`),
      ]);
      viewer.openSearch({ query: 'target', scope: 'all' });
      await wait(20);
      viewer.navigateSearch('next');
      await wait(10);
      getSearchPanelRoot(root)
        .querySelector('input[data-search]')
        ?.dispatchEvent(
          new Event('pointerdown', { bubbles: true, composed: true })
        );
      viewer.render(true);
      await waitFor(() =>
        viewer.getRenderedItems().some(({ id }) => id === 'two')
      );
      expect(viewer.getRenderedItems().map(({ id }) => id)).toContain('two');
      expect(label(root)).toBe('2/2');
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  for (const scroll of ['wheel', 'scrollTo', 'panel click']) {
    test(`a ${scroll} during a step ${scroll === 'panel click' ? 'does not interrupt it' : 'leaves its match selected, and the next step goes to it'}`, async () => {
      const blank = `blank ${'x'.repeat(80)}\n`.repeat(2000);
      await withViewer(
        [
          fileItem('one', `target\n${blank}`),
          fileItem('two', `target\n${blank}`),
          fileItem('three', 'target'),
        ],
        async ({ viewer, root, finish }) => {
          fillSearch(root, 'target');
          await finish();
          expect(label(root)).toBe('1/3');

          // The step selects the match in `two` and starts scrolling to it.
          viewer.navigateSearch('next');
          expect(getSearchState(viewer).current?.itemId).toBe('two');
          if (scroll === 'wheel') {
            root.dispatchEvent(new Event('wheel', { bubbles: true }));
          } else if (scroll === 'scrollTo') {
            viewer.scrollTo({
              type: 'item',
              id: 'one',
              align: 'start',
              behavior: 'instant',
            });
          } else {
            getSearchPanelRoot(root)
              .querySelector('[data-matches]')
              ?.dispatchEvent(
                new Event('pointerdown', { bubbles: true, composed: true })
              );
          }
          viewer.render(true);
          expect(label(root)).toBe('2/3');
          if (scroll === 'panel click') {
            // The view reached the match, so the next step moves on.
            expect(viewer.getRenderedItems().map(({ id }) => id)).toContain(
              'two'
            );
            viewer.navigateSearch('next');
            expect(getSearchState(viewer).current?.itemId).toBe('three');
            expect(label(root)).toBe('3/3');
            return;
          }
          expect(viewer.getRenderedItems().map(({ id }) => id)).not.toContain(
            'two'
          );

          viewer.navigateSearch('next');
          viewer.render(true);
          expect(getSearchState(viewer).current?.itemId).toBe('two');
          expect(label(root)).toBe('2/3');
          expect(viewer.getRenderedItems().map(({ id }) => id)).toContain(
            'two'
          );

          viewer.navigateSearch('next');
          expect(getSearchState(viewer).current?.itemId).toBe('three');
          expect(label(root)).toBe('3/3');
        }
      );
    });
  }

  for (const scroll of ['wheel', 'scrollTo']) {
    test(`a ${scroll} after a query keeps the view, still selects the match, and the next step goes to it`, async () => {
      const blank = `blank ${'x'.repeat(80)}\n`.repeat(2000);
      await withViewer(
        [
          fileItem('first', blank),
          fileItem('second', blank),
          fileItem('third', 'target\ntarget'),
        ],
        async ({ viewer, root, states, finish }) => {
          fillSearch(root, 'target');
          expect(getSearchState(viewer).current).toBeUndefined();
          if (scroll === 'wheel') {
            root.dispatchEvent(new Event('wheel', { bubbles: true }));
          } else {
            viewer.scrollTo({
              type: 'item',
              id: 'second',
              align: 'start',
              behavior: 'instant',
            });
          }
          viewer.render(true);
          const scrollTop = viewer.getScrollTop();
          await finish();
          expect(getSearchState(viewer).current?.itemId).toBe('third');
          expect(getSearchState(viewer).current?.lineNumber).toBe(1);
          expect(states.at(-1)?.currentMatchIndex).toBe(0);
          expect(label(root)).toBe('1/2');
          expect(viewer.getScrollTop()).toBe(scrollTop);
          expect(viewer.getRenderedItems().map(({ id }) => id)).not.toContain(
            'third'
          );

          viewer.navigateSearch('next');
          viewer.render(true);
          expect(getSearchState(viewer).current?.lineNumber).toBe(1);
          expect(label(root)).toBe('1/2');
          expect(viewer.getRenderedItems().map(({ id }) => id)).toContain(
            'third'
          );

          viewer.navigateSearch('next');
          expect(getSearchState(viewer).current?.lineNumber).toBe(2);
          expect(label(root)).toBe('2/2');
        }
      );
    });
  }

  for (const stage of ['finished', 'current', 'unreached']) {
    test(`editing the ${stage} item during a scan searches its current document text`, async () => {
      const blank = `blank ${'x'.repeat(80)}\n`.repeat(2000);
      const items = [
        fileItem('finished', 'target\n', true),
        fileItem('current', blank, true),
        fileItem('unreached', blank, true),
      ];
      await withViewer(items, async ({ viewer, root, finish }) => {
        for (const id of ['unreached', 'current', 'finished']) {
          viewer.scrollTo({
            type: 'item',
            id,
            align: 'start',
            behavior: 'instant',
          });
          viewer.render(true);
          await wait(0);
          expect(viewer.getEditor(id)).toBeDefined();
        }
        fillSearch(root, 'target');
        expect(getSearchState(viewer).matches).toHaveLength(1);
        const editor = viewer.getEditor(stage);
        if (editor == null) throw new Error(`Missing editor ${stage}`);
        editor.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 6 },
            },
            newText: stage === 'finished' ? 'gone' : 'target',
          },
        ]);
        viewer.render(true);
        await finish();
        expect(getSearchState(viewer).matches).toHaveLength(
          stage === 'finished' ? 0 : 2
        );
        if (stage !== 'finished')
          expect(
            getSearchState(viewer).matches.some(
              ({ itemId }) => itemId === stage
            )
          ).toBe(true);
      });
    });
  }

  test('a refresh keeps an unknown current internally while the panel has no current index', async () => {
    await withViewer(
      [fileItem('edit', undefined, true)],
      async ({ viewer, states, finish }) => {
        viewer.openSearch({ query: 'target', scope: { itemId: 'edit' } });
        await finish();
        const current = getSearchState(viewer).current;
        const editor = viewer.getEditor('edit');
        if (editor == null) throw new Error('Missing editor');
        editor.applyEdits([
          {
            range: {
              start: { line: 1, character: 7 },
              end: { line: 1, character: 7 },
            },
            newText: 'new',
          },
        ]);
        viewer.render(true);
        expect(states.at(-1)?.searching).toBe(true);
        expect(states.at(-1)?.currentMatchIndex).toBeUndefined();
        expect(getSearchState(viewer).current).toEqual(current);
        await finish();
        expect(getSearchState(viewer).current).toEqual(current);
      }
    );
  });

  test('a removed current is known absent even while other items are pending', async () => {
    await withViewer(
      [
        fileItem('small', `target\n${'blank\n'.repeat(200)}`),
        fileItem('large'),
      ],
      async ({ viewer, root, states, finish }) => {
        fillSearch(root, 'target');
        expect(getSearchState(viewer).current?.itemId).toBe('small');
        viewer.removeItem('small');
        viewer.render(true);
        expect(states.at(-1)?.searching).toBe(true);
        expect(getSearchState(viewer).current).toBeUndefined();
        await finish();
        expect(getSearchState(viewer).current).toBeUndefined();
      }
    );
  });

  for (const kind of ['file', 'diff']) {
    test(`scoped edited ${kind} matches an unsliced additions-only scan`, async () => {
      const original = `target old ${'x'.repeat(80)}\n`.repeat(2000);
      const contents = original.replaceAll('old', 'new');
      const fileDiff = parseDiffFromFile(
        { name: 'scoped.txt', contents: original },
        { name: 'scoped.txt', contents }
      );
      const item: CodeViewItem<undefined> =
        kind === 'file'
          ? fileItem('scoped', contents, true)
          : { id: 'scoped', type: 'diff', fileDiff, edit: true };
      await withViewer(
        [item, fileItem('other')],
        async ({ viewer, finish }) => {
          const editor = viewer.getEditor('scoped');
          if (editor == null) throw new Error('Missing scoped editor');
          editor.applyEdits([
            {
              range: {
                start: { line: 0, character: 7 },
                end: { line: 0, character: 7 },
              },
              newText: 'edited ',
            },
          ]);
          viewer.openSearch({ query: 'target', scope: { itemId: 'scoped' } });
          await finish();
          const scan = new CodeViewSearchScan(
            {
              text: 'target',
              replaceText: '',
              caseSensitive: false,
              regex: false,
              wholeWord: false,
            },
            1,
            () =>
              kind === 'file'
                ? { itemId: 'scoped', type: 'file', contents: editor.getText() }
                : {
                    itemId: 'scoped',
                    type: 'diff',
                    fileDiff,
                    additionContents: editor.getText(),
                    diffStyle: 'split',
                    additionsOnly: true,
                  },
            MAX_SEARCH_MATCHES
          );
          scan.advance();
          expect(getSearchState(viewer).matches).toEqual(scan.getMatches());
        }
      );
    });
  }

  test('nonempty items can start a scan before anything is rendered', async () => {
    const dom = installDom();
    let state: SearchPanelState | undefined;
    const viewer = new CodeView({
      onSearchStateChange: (next) => {
        state = next;
      },
    });
    let ticks = 0;
    const clock = spyOn(performance, 'now').mockImplementation(
      () => (ticks += 2)
    );
    try {
      const root = createRoot();
      viewer.setup(root);
      viewer.setItems([fileItem('first', 'target'), fileItem('not-rendered')]);
      viewer.openSearch({ query: '', scope: 'all' });
      expect(viewer.getRenderedItems()).toHaveLength(0);
      fillSearch(root, 'target');
      expect(state?.searching).toBe(true);
      expect(getSearchState(viewer).current?.itemId).toBe('first');
      await waitFor(() => state?.searching === false);
      expect(getSearchState(viewer).matches).toHaveLength(2001);
      expect(getSearchState(viewer).current?.lineNumber).toBe(1);
    } finally {
      clock.mockRestore();
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('the cap can finish a partially scanned item in a later slice', async () => {
    await withViewer(
      [
        fileItem('capped', 'target\n'.repeat(MAX_SEARCH_MATCHES + 1000)),
        fileItem('later', 'target'),
      ],
      async ({ viewer, root, states, finish }) => {
        fillSearch(root, 'target');
        expect(states.at(-1)?.searching).toBe(true);
        expect(getSearchState(viewer).matches).toHaveLength(0);
        await finish();
        expect(getSearchState(viewer).matches).toHaveLength(MAX_SEARCH_MATCHES);
        expect(getSearchState(viewer).matches.at(-1)?.lineNumber).toBe(
          MAX_SEARCH_MATCHES
        );
        expect(
          getSearchState(viewer).matches.every(
            ({ itemId }) => itemId === 'capped'
          )
        ).toBe(true);
      }
    );
  });

  test('localized searching label waits for a finished empty result', async () => {
    await withViewer([fileItem('a')], async ({ root, finish }) => {
      fillSearch(root, 'missing');
      i18n.set({
        messages: {
          searching: 'Recherche…',
          noSearchResults: 'Aucun résultat',
        },
      });
      expect(matches(root)?.ariaLabel).toBe('Recherche…');
      expect(matches(root)?.hasAttribute('data-searching')).toBe(true);
      expect(
        getSearchPanelRoot(root).querySelector('[data-no-matches]')
      ).toBeNull();
      await finish();
      expect(label(root)).toBe('Aucun résultat');
    });
  });

  test('the searching spinner is kept, not re-created, while find refreshes', async () => {
    await withViewer([fileItem('a')], async ({ viewer, root, finish }) => {
      fillSearch(root, 'missing');
      const spinner = matches(root)?.querySelector('svg');
      expect(spinner).not.toBeNull();
      const observer = new MutationObserver(() => {});
      observer.observe(matches(root)!, { attributeFilter: ['aria-label'] });
      // New items make the panel read its matches again while the search is
      // still running. The spinner must stay the same element.
      viewer.addItems([fileItem('b')]);
      viewer.render(true);
      i18n.set({ messages: { closeSearch: 'Dismiss' } });
      expect(observer.takeRecords()).toHaveLength(0);
      observer.disconnect();
      expect(matches(root)?.hasAttribute('data-searching')).toBe(true);
      expect(matches(root)?.querySelector('svg') === spinner).toBe(true);
      await finish();
      expect(label(root)).toBe('0/0');
    });
  });

  test('a hidden match can fill the last place at the cap', async () => {
    const cutLength = 'target '.length * (MAX_SEARCH_MATCHES - 1);
    await withViewer(
      [
        fileItem(
          'long',
          'target '.repeat(MAX_SEARCH_MATCHES + 100) + '\ntarget'
        ),
      ],
      async ({ viewer, root, finish }) => {
        fillSearch(root, 'target');
        await finish();
        const { matches } = getSearchState(viewer);
        expect(matches).toHaveLength(MAX_SEARCH_MATCHES);
        expect(matches.at(-1)?.startCharacter).toBe(cutLength);
      },
      { tokenizeMaxLineLength: cutLength }
    );
  });

  for (const query of ['', '[', 'target']) {
    test(`empty or invalid regex ${JSON.stringify(query)} finishes without work`, async () => {
      await withViewer(
        query === '[' ? [fileItem('invalid')] : [],
        ({ viewer, root, states }) => {
          viewer.openSearch({ query, scope: 'all' });
          if (query === '[') {
            const buttons =
              getSearchPanelRoot(root).querySelectorAll<HTMLButtonElement>(
                'button'
              );
            const regex = Array.from(buttons).find(
              (button) => button.title === i18n.t('regularExpression')
            );
            if (regex == null) throw new Error('Missing regex toggle');
            regex.click();
          }
          fillSearch(root, query);
          expect(states.at(-1)?.searching).toBe(false);
          expect(getSearchState(viewer).matches).toEqual([]);
        }
      );
    });
  }
});
