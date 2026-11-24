import { createTwoFilesPatch } from '@pierre/patches';
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';

import {
  CodeView,
  type CodeViewOptions,
  type CodeViewRenderedItem,
} from '../src/components/CodeView';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import {
  CodeViewSearchScan,
  MAX_SEARCH_MATCHES,
  type SearchPanelState,
} from '../src/search';
import type { CodeViewItem, FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';
import {
  fillSearch,
  getRenderedSearchMatches,
  getSearchPanelRoot,
  getSearchState,
} from './codeViewSearchHarness';
import {
  createRoot,
  installDom,
  renderItems,
  wait,
  waitFor,
} from './domHarness';
import { createDeferred } from './testUtils';

beforeAll(async () => {
  await getSharedHighlighter({
    themes: ['pierre-dark', 'pierre-light'],
    langs: ['text'],
    preferredHighlighter: 'shiki-js',
  });
});
afterAll(disposeHighlighter);

const largeBlank = `blank ${'x'.repeat(80)}\n`.repeat(2000);
const largeMatches = largeBlank.replaceAll('blank', 'target');

// Builds plain text items whose editor and search use the same source.
function fileItem(
  id: string,
  contents = 'target',
  edit = false
): CodeViewItem<undefined> {
  return { id, type: 'file', file: { name: `${id}.txt`, contents }, edit };
}

// Runs real rendering and background tasks with a clock-controlled slice budget.
async function withViewer(
  items: CodeViewItem<undefined>[],
  run: (context: {
    viewer: CodeView;
    root: HTMLElement;
    states: SearchPanelState[];
    slice(): void;
    finish(): Promise<void>;
  }) => Promise<void>,
  options: CodeViewOptions<undefined, undefined> = {}
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
  const clock = spyOn(performance, 'now').mockReturnValue(0);
  let ticks = 0;
  try {
    const root = createRoot();
    viewer.setup(root);
    await renderItems(viewer, items);
    viewer.openSearch({ query: '', scope: 'all' });
    await wait(0);
    await run({
      viewer,
      root,
      states,
      slice: () => {
        clock.mockImplementation(() => (ticks += 2));
      },
      finish: async () => {
        clock.mockReturnValue(0);
        viewer.render(true);
        await waitFor(() => states.at(-1)?.searching === false);
        expect(states.at(-1)?.searching).toBe(false);
      },
    });
  } finally {
    clock.mockRestore();
    viewer.cleanUp();
    dom.cleanup();
  }
}

// Reads the label a host's user sees in the find panel.
function label(root: HTMLElement): string | null | undefined {
  return getSearchPanelRoot(root).querySelector('[data-matches]')?.textContent;
}

describe('CodeView incremental find', () => {
  test('scrolling away from a partial large file paints another item before it finishes', async () => {
    const destination = `${'blank\n'.repeat(400)}target\n${'blank\n'.repeat(400)}`;
    await withViewer(
      [
        fileItem('large', largeMatches.repeat(10)),
        fileItem('destination', destination),
        fileItem('tail', largeBlank),
      ],
      async ({ viewer, root, states, slice, finish }) => {
        slice();
        fillSearch(root, 'target');
        expect(states.at(-1)?.searching).toBe(true);
        expect(getSearchState(viewer).matches).toEqual([]);
        viewer.scrollTo({
          type: 'line',
          id: 'destination',
          lineNumber: 401,
          align: 'start',
          behavior: 'instant',
        });
        viewer.render(true);
        expect(viewer.getRenderedItems().map(({ id }) => id)).toEqual([
          'destination',
        ]);
        await waitFor(() =>
          getRenderedSearchMatches(root).some(
            (range) => range.toString() === 'target'
          )
        );
        expect(states.at(-1)?.searching).toBe(true);
        expect(states.at(-1)?.matchCount).toBe(1);
        expect(
          getSearchState(viewer).matches.map(({ itemId }) => itemId)
        ).toEqual(['destination']);
        await finish();
        expect(states.at(-1)?.matchCount).toBe(20_001);
      }
    );
  });

  for (const direction of ['up', 'down']) {
    for (const diffStyle of ['split', 'unified'] satisfies (
      | 'split'
      | 'unified'
    )[]) {
      test(`scrolling ${direction} paints newly rendered ${diffStyle} diffs before search finishes`, async () => {
        const before = `target old ${'x'.repeat(80)}\n`.repeat(1200);
        const after = before.replaceAll('old', 'new');
        const fileDiff = parseDiffFromFile(
          { name: 'search.txt', contents: before },
          { name: 'search.txt', contents: after }
        );
        const items: CodeViewItem<undefined>[] = Array.from(
          { length: 30 },
          (_, index) => ({
            id: `diff-${index}`,
            type: 'diff',
            fileDiff,
          })
        );
        await withViewer(
          items,
          async ({ viewer, root, states, slice, finish }) => {
            viewer.scrollTo({
              type: 'item',
              id: 'diff-15',
              align: 'start',
              behavior: 'instant',
            });
            viewer.render(true);
            await wait(0);
            const rendered = viewer.getRenderedItems();
            expect(rendered.some(({ id }) => id === 'diff-15')).toBe(true);
            const start = items.findIndex(({ id }) => id === rendered[0].id);
            slice();
            fillSearch(root, 'target');
            expect(states.at(-1)?.searching).toBe(true);
            const destination = direction === 'up' ? 'diff-2' : 'diff-27';
            viewer.scrollTo({
              type: 'item',
              id: destination,
              align: 'start',
              behavior: 'instant',
            });
            viewer.render(true);
            expect(
              viewer.getRenderedItems().some(({ id }) => id === destination)
            ).toBe(true);
            expect(
              getSearchState(viewer).matches.some(
                ({ itemId }) => itemId === destination
              )
            ).toBe(false);
            await waitFor(() => {
              const item = viewer
                .getRenderedItems()
                .find(({ id }) => id === destination);
              return getRenderedSearchMatches(root).some((range) => {
                return (
                  range.startContainer.getRootNode() ===
                  item?.element.shadowRoot
                );
              });
            });
            expect(states.at(-1)?.searching).toBe(true);
            expect(
              getRenderedSearchMatches(root).every(
                (range) => range.toString() === 'target'
              )
            ).toBe(true);
            await finish();
            let previousCount = 0;
            for (const { matchCount } of states) {
              expect(matchCount).toBeGreaterThanOrEqual(previousCount);
              previousCount = matchCount;
            }
            const fresh = new CodeViewSearchScan(
              {
                text: 'target',
                replaceText: '',
                regex: false,
                wholeWord: false,
                caseSensitive: false,
              },
              items.length,
              (position) => ({
                type: 'diff',
                itemId: items[position].id,
                fileDiff,
                diffStyle,
                additionsOnly: false,
              }),
              MAX_SEARCH_MATCHES,
              start
            );
            fresh.advance();
            expect(getSearchState(viewer).matches).toEqual(fresh.getMatches());
            expect(states.at(-1)?.matchCount).toBe(fresh.getMatches().length);
          },
          { diffStyle }
        );
      });
    }
  }

  for (const stage of ['running', 'finished']) {
    test(`appending to a ${stage} search retains earlier matches and reports progress`, async () => {
      await withViewer(
        [fileItem('first'), fileItem('large', largeMatches)],
        async ({ viewer, root, states, slice, finish }) => {
          slice();
          fillSearch(root, 'target');
          if (stage === 'finished') await finish();
          const earlier = [...getSearchState(viewer).matches];
          slice();
          viewer.addItems([fileItem('appended', largeMatches)]);
          viewer.render(true);
          expect(states.at(-1)?.searching).toBe(true);
          for (const match of earlier)
            expect(getSearchState(viewer).matches).toContain(match);
          await finish();
          const matches = getSearchState(viewer).matches;
          expect(matches).toHaveLength(4001);
          for (let index = 0; index < earlier.length; index++)
            expect(matches[index]).toBe(earlier[index]);
          expect(states.at(-1)?.matchCount).toBe(4001);
          expect(label(root)).toContain('4,001');
          viewer.render(true);
          await wait(0);
          expect(getRenderedSearchMatches(root).length).toBeGreaterThan(0);
          expect(
            getRenderedSearchMatches(root).every(
              (range) => range.toString() === 'target'
            )
          ).toBe(true);
        }
      );
    });
  }

  for (const change of ['update', 'editor', 'instance']) {
    for (const stage of ['finished', 'current', 'unreached']) {
      test(`${change} of a ${stage} item preserves other completed matches`, async () => {
        const editable = change === 'editor';
        const items = [
          fileItem('anchor'),
          fileItem('finished', 'target old', editable),
          fileItem('current', largeBlank, editable),
          fileItem('unreached', largeBlank, editable),
        ];
        await withViewer(items, async ({ viewer, root, slice, finish }) => {
          let changedItem:
            | CodeViewRenderedItem<undefined, undefined>
            | undefined;
          for (const id of ['unreached', 'current', 'finished', 'anchor']) {
            viewer.scrollTo({
              type: 'item',
              id,
              align: 'start',
              behavior: 'instant',
            });
            viewer.render(true);
            await wait(0);
            if (id === stage)
              changedItem = viewer
                .getRenderedItems()
                .find((item) => item.id === id);
          }
          if (changedItem == null)
            throw new Error(`Missing rendered item ${stage}`);
          slice();
          fillSearch(root, 'target');
          const before = getSearchState(viewer).matches;
          expect(before.map(({ itemId }) => itemId)).toEqual([
            'anchor',
            'finished',
          ]);
          if (change === 'update')
            viewer.updateItem({
              ...fileItem(stage, 'target target'),
              version: 1,
            });
          else if (change === 'editor') {
            const editor = viewer.getEditor(stage);
            if (editor == null) throw new Error(`Missing editor ${stage}`);
            editor.applyEdits([
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: stage === 'finished' ? 10 : 5 },
                },
                newText: 'target target',
              },
            ]);
          } else {
            const item = viewer.getItem(stage);
            if (item?.type !== 'file') throw new Error('Expected file item');
            item.file.contents = 'target target';
            viewer.instanceChanged(changedItem.instance, true);
          }
          viewer.render(true);
          for (const match of before) {
            if (match.itemId !== stage)
              expect(
                getSearchState(viewer).matches.find(
                  (next) => next.itemId === match.itemId
                )
              ).toBe(match);
          }
          await finish();
          const matches = getSearchState(viewer).matches;
          expect(matches).toHaveLength(stage === 'finished' ? 3 : 4);
          expect(matches.filter(({ itemId }) => itemId === stage)).toHaveLength(
            2
          );
          for (const match of before) {
            const next = matches.find(
              (candidate) => candidate.itemId === match.itemId
            );
            if (match.itemId === stage) expect(next).not.toBe(match);
            else expect(next).toBe(match);
          }
        });
      });
    }
  }

  test('a small editor edit is searched in the same render pass', async () => {
    await withViewer(
      [fileItem('edit', 'target old', true), fileItem('other')],
      async ({ viewer, root, states, slice, finish }) => {
        fillSearch(root, 'target');
        await finish();
        const other = getSearchState(viewer).matches[1];
        const editor = viewer.getEditor('edit');
        if (editor == null) throw new Error('Missing editor');
        slice();
        editor.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 6 },
            },
            newText: 'target target',
          },
        ]);
        viewer.render(true);
        expect(getSearchState(viewer).matches).toHaveLength(3);
        expect(getSearchState(viewer).matches[2]).toBe(other);
        expect(states.at(-1)?.searching).toBe(false);
        expect(states.at(-1)?.matchCount).toBe(3);
        await wait(0);
        expect(
          getRenderedSearchMatches(root).map((range) => range.toString())
        ).toEqual(['target', 'target', 'target']);
      }
    );
  });

  test('a large changed item immediately loses its old results while its current match waits', async () => {
    await withViewer(
      [
        fileItem('before'),
        fileItem('edit', largeMatches, true),
        fileItem('after'),
      ],
      async ({ viewer, root, states, slice, finish }) => {
        fillSearch(root, 'target');
        await finish();
        viewer.navigateSearch('next');
        const current = getSearchState(viewer).current;
        const others = getSearchState(viewer).matches.filter(
          ({ itemId }) => itemId !== 'edit'
        );
        const editor = viewer.getEditor('edit');
        if (editor == null) throw new Error('Missing editor');
        slice();
        editor.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 6 },
            },
            newText: 'gone',
          },
        ]);
        viewer.render(true);
        expect(getSearchState(viewer).matches).toEqual(others);
        for (let index = 0; index < others.length; index++)
          expect(getSearchState(viewer).matches[index]).toBe(others[index]);
        expect(getSearchState(viewer).current).toBe(current);
        expect(states.at(-1)?.currentMatchIndex).toBeUndefined();
        expect(states.at(-1)?.searching).toBe(true);
        await finish();
        expect(getSearchState(viewer).matches).toHaveLength(2001);
        expect(getSearchState(viewer).current).toBeUndefined();
        expect(states.at(-1)?.currentMatchIndex).toBeUndefined();
      }
    );
  });

  test('clearing the query with no current match removes the painted matches', async () => {
    await withViewer(
      [fileItem('file')],
      async ({ viewer, root, states, finish }) => {
        fillSearch(root, 'target');
        await finish();
        expect(getSearchState(viewer).current).toBeDefined();
        // New contents move the only match, which leaves no current match.
        viewer.updateItem({ ...fileItem('file', '---- target'), version: 1 });
        await finish();
        expect(getSearchState(viewer).current).toBeUndefined();
        expect(getRenderedSearchMatches(root)).toHaveLength(1);
        fillSearch(root, '');
        await waitFor(() => states.at(-1)?.matchCount === 0);
        expect(getRenderedSearchMatches(root)).toHaveLength(0);
      }
    );
  });

  test('removal keeps later match objects and the current match at its new index', async () => {
    await withViewer(
      [
        fileItem('before', 'target target'),
        fileItem('middle'),
        fileItem('later', 'target target'),
      ],
      async ({ viewer, root, states, finish }) => {
        fillSearch(root, 'target');
        await finish();
        for (let step = 0; step < 3; step++) viewer.navigateSearch('next');
        const current = getSearchState(viewer).current;
        const kept = getSearchState(viewer).matches.slice(2);
        viewer.removeItem('before');
        await finish();
        expect(getSearchState(viewer).matches).toEqual(kept);
        for (let index = 0; index < kept.length; index++)
          expect(getSearchState(viewer).matches[index]).toBe(kept[index]);
        expect(getSearchState(viewer).current).toBe(current);
        expect(states.at(-1)?.currentMatchIndex).toBe(1);
        expect(label(root)).toBe('2/3');
      }
    );
  });

  for (const change of ['update', 'remove', 'add']) {
    test(`${change} at the match limit ${change === 'add' ? 'changes nothing' : 'searches on from where the limit stopped'}`, async () => {
      await withViewer(
        [
          fileItem('capped', 'target\n'.repeat(MAX_SEARCH_MATCHES)),
          fileItem('later'),
        ],
        async ({ viewer, root, finish }) => {
          fillSearch(root, 'target');
          await finish();
          const before = getSearchState(viewer).matches;
          expect(before).toHaveLength(MAX_SEARCH_MATCHES);
          if (change === 'update')
            viewer.updateItem({ ...fileItem('capped', 'missing'), version: 1 });
          else if (change === 'remove') viewer.removeItem('capped');
          else viewer.addItems([fileItem('new')]);
          await finish();
          if (change === 'add')
            expect(getSearchState(viewer).matches).toBe(before);
          else {
            expect(getSearchState(viewer).matches).toHaveLength(1);
            expect(getSearchState(viewer).matches[0].itemId).toBe('later');
            expect(getSearchState(viewer).matches[0]).not.toBe(before[0]);
          }
        }
      );
    });
  }

  test('an edit at the match limit finds the rest of the item the limit cut short', async () => {
    // The first item holds about 60% of the limit and the second about 70%, so
    // the limit is reached part way through the second.
    const matchesPerLine = 100;
    const line = `${'target '.repeat(matchesPerLine)}\n`;
    const editedLines = Math.ceil((MAX_SEARCH_MATCHES * 0.6) / matchesPerLine);
    const cutLines = Math.ceil((MAX_SEARCH_MATCHES * 0.7) / matchesPerLine);
    const editedCount = editedLines * matchesPerLine;
    const cutCount = cutLines * matchesPerLine;
    await withViewer(
      [
        fileItem('edited', line.repeat(editedLines)),
        fileItem('cut', line.repeat(cutLines)),
        fileItem('later'),
      ],
      async ({ viewer, root, states, finish }) => {
        fillSearch(root, 'target');
        await finish();
        const before = getSearchState(viewer).matches;
        expect(before).toHaveLength(MAX_SEARCH_MATCHES);
        expect(before.filter(({ itemId }) => itemId === 'cut')).toHaveLength(
          MAX_SEARCH_MATCHES - editedCount
        );
        viewer.updateItem({ ...fileItem('edited', 'missing'), version: 1 });
        await finish();
        const matches = getSearchState(viewer).matches;
        expect(matches.filter(({ itemId }) => itemId === 'cut')).toHaveLength(
          cutCount
        );
        expect(matches.at(-1)?.itemId).toBe('later');
        expect(matches).toHaveLength(cutCount + 1);
        expect(states.at(-1)?.matchCount).toBe(cutCount + 1);
      }
    );
  });

  test('outside changes leave a scoped search intact and removing its item clears scope', async () => {
    await withViewer(
      [fileItem('scoped', 'target target', true), fileItem('other')],
      async ({ viewer, finish }) => {
        viewer.openSearch({
          query: 'target',
          scope: { itemId: 'scoped' },
          mode: 'replace',
        });
        await finish();
        const before = getSearchState(viewer).matches;
        viewer.updateItem({
          ...fileItem('other', 'target target'),
          version: 1,
        });
        viewer.addItems([fileItem('new')]);
        await finish();
        expect(getSearchState(viewer).matches).toBe(before);
        viewer.removeItem('new');
        await finish();
        expect(getSearchState(viewer).matches).toBe(before);
        viewer.removeItem('scoped');
        await finish();
        expect(getSearchState(viewer).scope).toBeUndefined();
        expect(
          getSearchState(viewer).matches.map(({ itemId }) => itemId)
        ).toEqual(['other', 'other']);
      }
    );
  });

  for (const kind of ['file', 'diff']) {
    test(`updateItem installs an offscreen ${kind} editor replacement before normal search resumes`, async () => {
      const before = 'old\ntext';
      const initial = 'target old\ntext';
      const replacement = 'text\ntarget target';
      const item: CodeViewItem<undefined> =
        kind === 'file'
          ? fileItem('edit', initial, true)
          : {
              id: 'edit',
              type: 'diff',
              edit: true,
              fileDiff: parseDiffFromFile(
                { name: 'edit.txt', contents: before },
                { name: 'edit.txt', contents: initial }
              ),
            };
      await withViewer(
        [item, fileItem('padding', largeBlank)],
        async ({ viewer, root, slice, finish }) => {
          const editor = viewer.getEditor('edit');
          if (editor == null) throw new Error('Missing retained editor');
          viewer.scrollTo({
            type: 'line',
            id: 'padding',
            lineNumber: 1000,
            align: 'start',
            behavior: 'instant',
          });
          viewer.render(true);
          await wait(0);
          expect(
            viewer.getRenderedItems().some(({ id }) => id === 'edit')
          ).toBe(false);
          slice();
          fillSearch(root, 'target');
          viewer.updateItem(
            kind === 'file'
              ? { ...fileItem('edit', replacement, true), version: 1 }
              : {
                  id: 'edit',
                  type: 'diff',
                  edit: true,
                  version: 1,
                  fileDiff: parseDiffFromFile(
                    { name: 'edit.txt', contents: before },
                    { name: 'edit.txt', contents: replacement }
                  ),
                }
          );
          await finish();
          expect(viewer.getEditor('edit')).toBe(editor);
          expect(editor.getText()).toBe(replacement);
          expect(
            getSearchState(viewer).matches.filter(
              ({ itemId }) => itemId === 'edit'
            )
          ).toHaveLength(2);
          expect(
            getSearchState(viewer)
              .matches.filter(({ itemId }) => itemId === 'edit')
              .map(({ lineNumber }) => lineNumber)
          ).toEqual([2, 2]);
        }
      );
    });
  }

  for (const diffStyle of ['split', 'unified'] satisfies (
    | 'split'
    | 'unified'
  )[]) {
    test(`${diffStyle} deleting lines in an edited diff searches the new rows`, async () => {
      const old = largeMatches;
      const next = old.replaceAll('target', 'target new');
      const item: CodeViewItem<undefined> = {
        id: 'edit',
        type: 'diff',
        edit: true,
        fileDiff: parseDiffFromFile(
          { name: 'edit.txt', contents: old },
          { name: 'edit.txt', contents: next }
        ),
      };
      await withViewer(
        [fileItem('other'), item],
        async ({ viewer, root, slice, finish }) => {
          fillSearch(root, 'target');
          await finish();
          const other = getSearchState(viewer).matches[0];
          const editor = viewer.getEditor('edit');
          if (editor == null) throw new Error('Missing diff editor');
          slice();
          editor.applyEdits([
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 1000, character: 0 },
              },
              newText: '',
            },
          ]);
          await finish();
          const matches = getSearchState(viewer).matches;
          expect(matches[0]).toBe(other);
          expect(
            matches.filter(
              ({ itemId, side }) => itemId === 'edit' && side === 'additions'
            )
          ).toHaveLength(1000);
          expect(
            matches.filter(
              ({ itemId, side }) => itemId === 'edit' && side === 'deletions'
            )
          ).toHaveLength(2000);
          expect(matches).toHaveLength(3001);
        },
        { diffStyle }
      );
    });
  }

  test('a partial diff filled in before a normal render searches loaded context', async () => {
    const oldFile: FileContents = {
      name: 'partial.txt',
      contents: 'target context\nold\nend\n',
    };
    const newFile: FileContents = {
      name: oldFile.name,
      contents: 'target context\nnew\nend\n',
    };
    const partial = parsePatchFiles(
      createTwoFilesPatch(
        oldFile.name,
        newFile.name,
        oldFile.contents,
        newFile.contents,
        undefined,
        undefined,
        { context: 0 }
      ),
      { throwOnError: true }
    )[0]?.files[0];
    if (partial == null) throw new Error('Missing partial fixture');
    const loaded = createDeferred<{
      oldFile: FileContents;
      newFile: FileContents;
    }>();
    await withViewer(
      [fileItem('other'), { id: 'partial', type: 'diff', fileDiff: partial }],
      async ({ viewer, root, finish }) => {
        fillSearch(root, 'target');
        await finish();
        const other = getSearchState(viewer).matches[0];
        expect(getSearchState(viewer).matches).toHaveLength(1);
        const item = viewer
          .getRenderedItems()
          .find(({ id }) => id === 'partial');
        if (item?.type !== 'diff') throw new Error('Missing partial instance');
        item.instance.expandHunk(0, 'up', 1);
        loaded.resolve({ oldFile, newFile });
        await waitFor(() => partial.isPartial === false);
        expect(partial.isPartial).toBe(false);
        await finish();
        expect(getSearchState(viewer).matches).toHaveLength(3);
        expect(getSearchState(viewer).matches[0]).toBe(other);
        expect(
          getSearchState(viewer)
            .matches.filter(({ itemId }) => itemId === 'partial')
            .map(({ lineNumber }) => lineNumber)
        ).toEqual([1, 1]);
      },
      { loadDiffFiles: () => loaded.promise }
    );
  });

  for (const change of ['rename', 'options']) {
    test(`${change} still starts a new search`, async () => {
      await withViewer(
        [fileItem('first'), fileItem('second')],
        async ({ viewer, root, finish }) => {
          fillSearch(root, 'target');
          await finish();
          const before = getSearchState(viewer).matches;
          if (change === 'rename') viewer.updateItemId('first', 'renamed');
          else viewer.setOptions({ diffStyle: 'unified' });
          await finish();
          const matches = getSearchState(viewer).matches;
          expect(matches).toHaveLength(2);
          expect(matches[0].itemId).toBe(
            change === 'rename' ? 'renamed' : 'first'
          );
          expect(matches[0]).not.toBe(before[0]);
          expect(matches[1]).not.toBe(before[1]);
        }
      );
    });
  }

  test('setItems append still starts a new search', async () => {
    const first = fileItem('first');
    await withViewer([first], async ({ viewer, root, finish }) => {
      fillSearch(root, 'target');
      await finish();
      const before = getSearchState(viewer).matches[0];
      viewer.setItems([first, fileItem('new')]);
      await finish();
      expect(getSearchState(viewer).matches).toHaveLength(2);
      expect(getSearchState(viewer).matches[0]).not.toBe(before);
    });
  });
});
