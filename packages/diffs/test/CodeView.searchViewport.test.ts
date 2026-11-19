import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';

import { CodeView, type CodeViewOptions } from '../src/components/CodeView';
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
import type { CodeViewItem, FileDiffMetadata } from '../src/types';
import { getLineIndexForDiff } from '../src/utils/getLineIndexForDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';
import {
  dispatchEscape,
  fillReplace,
  fillSearch,
  getSearchInput,
  getSearchState,
  pressSearchEnter,
  replaceFromPanel,
} from './codeViewSearchHarness';
import {
  createRoot,
  dispatchScroll,
  installDom,
  renderItems,
  wait,
  waitFor,
} from './domHarness';
import { collectDiffRows } from './testUtils';

beforeAll(async () => {
  await getSharedHighlighter({
    themes: ['pierre-dark', 'pierre-light'],
    langs: ['text'],
    preferredHighlighter: 'shiki-js',
  });
});
afterAll(disposeHighlighter);

const params = {
  text: 'target',
  replaceText: '',
  regex: false,
  caseSensitive: false,
  wholeWord: false,
};
const diffStyles: ('split' | 'unified')[] = ['split', 'unified'];

// Dense source lines put thousands of matches before the viewport without synthetic rows.
function makeItem(
  kind: 'file' | 'diff',
  id: string,
  lines = 6000
): CodeViewItem<undefined> {
  const contents = Array.from(
    { length: lines },
    (_, index) => `target ${index}`
  ).join('\n');
  return kind === 'file'
    ? { id, type: 'file', file: { name: `${id}.txt`, contents } }
    : {
        id,
        type: 'diff',
        fileDiff: parseDiffFromFile(
          { name: `${id}.txt`, contents },
          {
            name: `${id}.txt`,
            contents: contents.replaceAll('target', 'target changed'),
          },
          { disableLineMatching: true, preferredDiffLib: '@pierre/patches' }
        ),
      };
}

// Uses real CodeView layout and editor documents; only the scan clock is controlled.
async function withViewer(
  items: CodeViewItem<undefined>[],
  run: (context: {
    viewer: CodeView;
    root: HTMLElement;
    states: SearchPanelState[];
    slice(): void;
    finish(): Promise<void>;
  }) => void | Promise<void>,
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

// Checks the extracted mapping against the actual walker rows, including hidden context.
function checkDiffRows(
  diff: FileDiffMetadata,
  diffStyle: 'split' | 'unified',
  additionContents?: string,
  additionsOnly = false
): void {
  const rows = new Map<string, [number, number]>();
  for (const { additionLine, deletionLine } of collectDiffRows({
    diff,
    diffStyle,
    expandedHunks: true,
  })) {
    if (additionLine != null)
      rows.set(`additions:${additionLine.lineNumber}`, [
        additionLine.unifiedLineIndex,
        additionLine.splitLineIndex,
      ]);
    if (deletionLine != null)
      rows.set(`deletions:${deletionLine.lineNumber}`, [
        deletionLine.unifiedLineIndex,
        deletionLine.splitLineIndex,
      ]);
  }
  const scan = new CodeViewSearchScan(
    params,
    1,
    () => ({
      itemId: 'item',
      type: 'diff',
      fileDiff: diff,
      diffStyle,
      additionContents,
      additionsOnly,
    }),
    MAX_SEARCH_MATCHES
  );
  scan.advance();
  let previous = -1;
  for (const match of scan.getMatches()) {
    const indexes = getLineIndexForDiff(
      diff,
      match.lineNumber,
      match.side ?? 'additions'
    );
    expect(indexes).toEqual(rows.get(`${match.side}:${match.lineNumber}`));
    if (indexes == null) throw new Error('Matched source row is undefined');
    const row = indexes[diffStyle === 'split' ? 1 : 0];
    expect(row).toBeGreaterThanOrEqual(previous);
    previous = row;
  }
  expect(scan.getMatches().length).toBeGreaterThan(0);
}

describe('CodeView viewport search', () => {
  const file: CodeViewItem<undefined> = {
    id: 'file',
    type: 'file',
    file: {
      name: 'matches.txt',
      contents: [
        'line\n'.repeat(150),
        'target\n',
        'line\n'.repeat(150),
        'target again\n',
        'line\n'.repeat(80),
        'target again later\n',
        'line\n'.repeat(80),
      ].join(''),
    },
  };

  // Finishes the scroll before find reads the viewport.
  function scrollToPosition(
    viewer: CodeView,
    root: HTMLElement,
    position: number
  ): void {
    root.scrollTop = position;
    dispatchScroll(root);
    viewer.render(true);
    expect(viewer.getScrollTop()).toBe(position);
  }

  // Types the query and checks that find actually moved the viewport.
  function findTarget(viewer: CodeView, root: HTMLElement): void {
    const before = viewer.getScrollTop();
    fillSearch(root, 'target');
    viewer.render(true);
    expect(getSearchState(viewer).current?.lineNumber).toBe(151);
    expect(viewer.getScrollTop()).toBeGreaterThan(before);
    expect(viewer.pendingScrollTarget).toBeUndefined();
  }

  for (const stickyHeaders of [false, true]) {
    describe(`returning to the viewport with stickyHeaders=${stickyHeaders}`, () => {
      test('Escape returns to the original line after find opens a collapsed file above it', async () => {
        await withViewer(
          [
            { ...file, collapsed: true },
            {
              id: 'after',
              type: 'file',
              file: { name: 'after.txt', contents: 'end\n'.repeat(200) },
            },
          ],
          ({ viewer, root }) => {
            scrollToPosition(viewer, root, 517);
            const before = viewer.getTopForItem('after')!;
            findTarget(viewer, root);
            const after = viewer.getTopForItem('after')!;
            expect(after).toBeGreaterThan(before);
            dispatchEscape(root);
            viewer.render(true);
            expect(viewer.getScrollTop()).toBe(517 + after - before);
          },
          { stickyHeaders }
        );
      });

      test('clearing the query restores the viewport and keeps find open', async () => {
        await withViewer(
          [file],
          ({ viewer, root }) => {
            scrollToPosition(viewer, root, 517);
            findTarget(viewer, root);
            fillSearch(root, '');
            viewer.render(true);
            expect(viewer.getScrollTop()).toBe(517);
            expect(getSearchInput(root).value).toBe('');
          },
          { stickyHeaders }
        );
      });

      test('closeSearch restores the viewport after opening with a query', async () => {
        await withViewer(
          [file],
          async ({ viewer, root }) => {
            viewer.closeSearch();
            scrollToPosition(viewer, root, 517);
            viewer.openSearch({ query: 'target' });
            await waitFor(() => viewer.getScrollTop() > 517);
            expect(viewer.getScrollTop()).toBeGreaterThan(517);
            viewer.closeSearch();
            viewer.render(true);
            expect(viewer.getScrollTop()).toBe(517);
            expect(root.querySelector('[data-search-panel]')).toBeNull();
          },
          { stickyHeaders }
        );
      });

      for (const surface of ['code', 'find panel']) {
        test(`Escape keeps the position after a wheel scroll over the ${surface}`, async () => {
          await withViewer(
            [file],
            ({ viewer, root }) => {
              scrollToPosition(viewer, root, 517);
              findTarget(viewer, root);
              const target = surface === 'code' ? root : getSearchInput(root);
              target.dispatchEvent(
                new window.Event('wheel', { bubbles: true, composed: true })
              );
              root.scrollTop = 1203;
              dispatchScroll(root);
              viewer.render(true);
              expect(viewer.getScrollTop()).toBe(1203);
              dispatchEscape(root);
              viewer.render(true);
              expect(viewer.getScrollTop()).toBe(1203);
            },
            { stickyHeaders }
          );
        });
      }

      test('Escape returns to the wheel position after a refined query jumps', async () => {
        await withViewer(
          [file],
          ({ viewer, root }) => {
            findTarget(viewer, root);
            root.dispatchEvent(new window.Event('wheel', { bubbles: true }));
            scrollToPosition(viewer, root, 1203);
            fillSearch(root, 'target again later');
            viewer.render(true);
            expect(viewer.getScrollTop()).toBeGreaterThan(1203);
            dispatchEscape(root);
            viewer.render(true);
            expect(viewer.getScrollTop()).toBe(1203);
          },
          { stickyHeaders }
        );
      });

      test('Escape returns to the hand-scrolled position after a cut line is expanded', async () => {
        const cut: CodeViewItem<undefined> = {
          id: 'cut',
          type: 'file',
          file: {
            name: 'cut.txt',
            contents: `${'line\n'.repeat(150)}----target\n${'line\n'.repeat(150)}`,
          },
        };
        await withViewer(
          [cut],
          async ({ viewer, root }) => {
            const start = viewer.getScrollTop();
            fillSearch(root, 'target');
            viewer.render(true);
            // The match is in the hidden part of line 151, on its button.
            expect(getSearchState(viewer).current).toMatchObject({
              lineNumber: 151,
              cutOff: true,
            });
            const jumped = viewer.getScrollTop();
            expect(jumped).toBeGreaterThan(start);
            root.dispatchEvent(new window.Event('wheel', { bubbles: true }));
            scrollToPosition(viewer, root, jumped + 80);
            const placed = viewer.getScrollTop();
            viewer.getRenderedItems()[0].instance.expandLine({
              additionLineNumber: 151,
            });
            await waitFor(
              () => getSearchState(viewer).current?.cutOff !== true
            );
            viewer.render(true);
            dispatchEscape(root);
            viewer.render(true);
            expect(viewer.getScrollTop()).toBe(placed);
          },
          { stickyHeaders, tokenizeMaxLineLength: 4 }
        );
      });

      for (const change of ['typing', 'openSearch']) {
        test(`Escape returns to the stepped match after ${change} refines the query`, async () => {
          await withViewer(
            [file],
            ({ viewer, root }) => {
              findTarget(viewer, root);
              pressSearchEnter(root);
              viewer.render(true);
              expect(getSearchState(viewer).current?.lineNumber).toBe(302);
              const second = viewer.getScrollTop();
              if (change === 'typing') {
                fillSearch(root, 'target again later');
              } else {
                viewer.openSearch({
                  scope: 'all',
                  query: 'target again later',
                });
              }
              viewer.render(true);
              expect(viewer.getScrollTop()).toBeGreaterThan(second);
              dispatchEscape(root);
              viewer.render(true);
              expect(viewer.getScrollTop()).toBe(second);
            },
            { stickyHeaders }
          );
        });
      }

      test('Escape keeps the caret revealed by setSelections', async () => {
        await withViewer(
          [{ ...file, edit: true }],
          ({ viewer, root }) => {
            findTarget(viewer, root);
            const first = viewer.getScrollTop();
            const caret = { line: 350, character: 0 };
            viewer
              .getEditor('file')!
              .setSelections([{ start: caret, end: caret, direction: 'none' }]);
            viewer.render(true);
            const top = viewer.getScrollTop();
            expect(top).toBeGreaterThan(first);
            dispatchEscape(root);
            viewer.render(true);
            expect(viewer.getScrollTop()).toBe(top);
          },
          { stickyHeaders }
        );
      });

      test('Escape keeps the position set by a host scrollTo', async () => {
        await withViewer(
          [file],
          ({ viewer, root }) => {
            findTarget(viewer, root);
            const first = viewer.getScrollTop();
            viewer.scrollTo({
              type: 'position',
              position: 1203,
              behavior: 'instant',
            });
            viewer.render(true);
            const top = viewer.getScrollTop();
            expect(top).toBeGreaterThan(0);
            expect(top).toBeLessThan(first);
            dispatchEscape(root);
            viewer.render(true);
            expect(viewer.getScrollTop()).toBe(top);
          },
          { stickyHeaders }
        );
      });

      test('Escape returns after a pointer press in the code that did not scroll', async () => {
        await withViewer(
          [file],
          ({ viewer, root }) => {
            scrollToPosition(viewer, root, 517);
            findTarget(viewer, root);
            const row = viewer
              .getRenderedItems()[0]
              .element.shadowRoot!.querySelector('[data-line="151"]')!;
            row.dispatchEvent(
              new window.Event('pointerdown', { bubbles: true, composed: true })
            );
            dispatchEscape(root);
            viewer.render(true);
            expect(viewer.getScrollTop()).toBe(517);
          },
          { stickyHeaders }
        );
      });

      test('Escape returns during a smooth scroll to the first match', async () => {
        await withViewer(
          [file],
          async ({ viewer, root, slice }) => {
            scrollToPosition(viewer, root, 517);
            fillSearch(root, 'target');
            slice();
            await waitFor(() => viewer.getScrollTop() > 517);
            expect(viewer.getScrollTop()).toBeGreaterThan(517);
            expect(viewer.pendingScrollTarget).toMatchObject({
              type: 'line',
              searchMatch: true,
            });
            dispatchEscape(root);
            await waitFor(() => viewer.pendingScrollTarget == null);
            expect(viewer.getScrollTop()).toBe(517);
          },
          { stickyHeaders, searchOptions: { scrollBehavior: 'smooth' } }
        );
      });

      test('Escape returns after a pointer press interrupts a smooth find scroll', async () => {
        await withViewer(
          [file],
          async ({ viewer, root, slice }) => {
            scrollToPosition(viewer, root, 517);
            fillSearch(root, 'target');
            slice();
            await waitFor(() => viewer.getScrollTop() > 517);
            const stopped = viewer.getScrollTop();
            expect(stopped).toBeGreaterThan(517);
            expect(viewer.pendingScrollTarget).toMatchObject({
              searchMatch: true,
            });
            root.dispatchEvent(
              new window.Event('pointerdown', { bubbles: true })
            );
            expect(viewer.pendingScrollTarget).toBeUndefined();
            expect(viewer.getScrollTop()).toBe(stopped);
            dispatchEscape(root);
            await waitFor(() => viewer.pendingScrollTarget == null);
            expect(viewer.getScrollTop()).toBe(517);
          },
          { stickyHeaders, searchOptions: { scrollBehavior: 'smooth' } }
        );
      });

      test('Escape keeps the wheel position after a panel wheel interrupts a smooth find scroll', async () => {
        await withViewer(
          [file],
          async ({ viewer, root, slice }) => {
            scrollToPosition(viewer, root, 517);
            fillSearch(root, 'target');
            slice();
            await waitFor(() => viewer.getScrollTop() > 517);
            expect(viewer.pendingScrollTarget).toMatchObject({
              searchMatch: true,
            });
            getSearchInput(root).dispatchEvent(
              new window.Event('wheel', { bubbles: true, composed: true })
            );
            expect(viewer.pendingScrollTarget).toBeUndefined();
            scrollToPosition(viewer, root, 1203);
            dispatchEscape(root);
            await waitFor(() => viewer.pendingScrollTarget == null);
            expect(viewer.getScrollTop()).toBe(1203);
          },
          { stickyHeaders, searchOptions: { scrollBehavior: 'smooth' } }
        );
      });

      test('Escape returns to the start after typing during a smooth find scroll', async () => {
        await withViewer(
          [file],
          async ({ viewer, root, slice }) => {
            scrollToPosition(viewer, root, 517);
            fillSearch(root, 'target');
            slice();
            await waitFor(() => viewer.getScrollTop() > 517);
            expect(viewer.getScrollTop()).toBeGreaterThan(517);
            expect(viewer.pendingScrollTarget).toMatchObject({
              searchMatch: true,
              lineNumber: 151,
            });
            fillSearch(root, 'target again later');
            await waitFor(() => viewer.pendingScrollTarget == null);
            expect(getSearchState(viewer).current?.lineNumber).toBe(383);
            expect(viewer.getScrollTop()).toBeGreaterThan(517);
            dispatchEscape(root);
            await waitFor(() => viewer.pendingScrollTarget == null);
            expect(viewer.getScrollTop()).toBe(517);
          },
          { stickyHeaders, searchOptions: { scrollBehavior: 'smooth' } }
        );
      });

      test('Escape returns into the item renamed by updateItemId', async () => {
        await withViewer(
          [{ ...file }],
          ({ viewer, root }) => {
            scrollToPosition(viewer, root, 517);
            findTarget(viewer, root);
            expect(viewer.updateItemId('file', 'renamed')).toBe(true);
            viewer.render(true);
            dispatchEscape(root);
            viewer.render(true);
            expect(viewer.getScrollTop()).toBe(517);
            expect(viewer.getScrollAnchor(517)?.id).toBe('renamed');
          },
          { stickyHeaders }
        );
      });

      test('Escape leaves an already visible first match in place', async () => {
        await withViewer(
          [file],
          ({ viewer, root }) => {
            viewer.scrollTo({
              type: 'line',
              id: 'file',
              lineNumber: 151,
              align: 'center',
              behavior: 'instant',
            });
            viewer.render(true);
            const before = viewer.getScrollTop();
            fillSearch(root, 'target');
            expect(getSearchState(viewer).current?.lineNumber).toBe(151);
            expect(viewer.getScrollTop()).toBe(before);
            dispatchEscape(root);
            viewer.render(true);
            expect(viewer.getScrollTop()).toBe(before);
          },
          { stickyHeaders }
        );
      });

      test('Escape keeps the next match in view after a find step', async () => {
        await withViewer(
          [file],
          ({ viewer, root }) => {
            findTarget(viewer, root);
            const first = viewer.getScrollTop();
            pressSearchEnter(root);
            viewer.render(true);
            const second = viewer.getScrollTop();
            expect(second).toBeGreaterThan(first);
            dispatchEscape(root);
            viewer.render(true);
            expect(viewer.getScrollTop()).toBe(second);
          },
          { stickyHeaders }
        );
      });

      for (const { name, position } of [
        {
          name: 'Escape returns to the original offset after a longer query jumps again',
          position: 517,
        },
        {
          name: 'Escape returns to the top after a longer query jumps again',
          position: 0,
        },
      ]) {
        test(name, async () => {
          await withViewer(
            [file],
            ({ viewer, root }) => {
              scrollToPosition(viewer, root, position);
              findTarget(viewer, root);
              const first = viewer.getScrollTop();
              fillSearch(root, 'target again');
              viewer.render(true);
              expect(viewer.getScrollTop()).toBeGreaterThan(first);
              dispatchEscape(root);
              viewer.render(true);
              expect(viewer.getScrollTop()).toBe(position);
            },
            { stickyHeaders }
          );
        });
      }

      test('Escape keeps the next match in view after replacing a match', async () => {
        await withViewer(
          [{ ...file, edit: true }],
          ({ viewer, root }) => {
            viewer.openSearch({ scope: { itemId: 'file' }, mode: 'replace' });
            findTarget(viewer, root);
            const first = viewer.getScrollTop();
            fillReplace(root, 'changed');
            replaceFromPanel(root);
            viewer.render(true);
            expect(getSearchState(viewer).current?.lineNumber).toBe(302);
            expect(viewer.getEditor('file')?.getText()).toContain('changed');
            const second = viewer.getScrollTop();
            expect(second).toBeGreaterThan(first);
            dispatchEscape(root);
            viewer.render(true);
            expect(viewer.getScrollTop()).toBe(second);
          },
          { stickyHeaders }
        );
      });

      test('Escape keeps the viewport after Replace All', async () => {
        await withViewer(
          [{ ...file, edit: true }],
          ({ viewer, root }) => {
            viewer.openSearch({ scope: { itemId: 'file' }, mode: 'replace' });
            findTarget(viewer, root);
            fillReplace(root, 'changed');
            replaceFromPanel(root, true);
            viewer.render(true);
            expect(viewer.getEditor('file')!.getText()).not.toContain('target');
            const after = viewer.getScrollTop();
            expect(after).toBeGreaterThan(0);
            dispatchEscape(root);
            viewer.render(true);
            expect(viewer.getScrollTop()).toBe(after);
          },
          { stickyHeaders }
        );
      });

      test('Escape returns to where Replace All was pressed when find jumps to text that still matches', async () => {
        await withViewer(
          [{ ...file, edit: true }],
          ({ viewer, root }) => {
            viewer.openSearch({ scope: { itemId: 'file' }, mode: 'replace' });
            findTarget(viewer, root);
            scrollToPosition(viewer, root, 1203);
            const before = viewer.getScrollTop();
            fillReplace(root, 'changed target');
            replaceFromPanel(root, true);
            viewer.render(true);
            expect(viewer.getEditor('file')!.getText()).toContain(
              'changed target'
            );
            expect(viewer.getScrollTop()).not.toBe(before);
            dispatchEscape(root);
            viewer.render(true);
            expect(viewer.getScrollTop()).toBe(before);
          },
          { stickyHeaders }
        );
      });

      test('reset closes find without requesting a return scroll', async () => {
        await withViewer(
          [file],
          ({ viewer, root }) => {
            findTarget(viewer, root);
            const scroll = spyOn(viewer, 'requestScroll');
            try {
              viewer.reset();
              expect(scroll).not.toHaveBeenCalled();
              expect(root.querySelector('[data-search-panel]')).toBeNull();
            } finally {
              scroll.mockRestore();
            }
          },
          { stickyHeaders }
        );
      });
    });
  }

  const views: { kind: 'file' | 'diff'; diffStyle: 'split' | 'unified' }[] = [
    { kind: 'file', diffStyle: 'split' },
    { kind: 'diff', diffStyle: 'split' },
    { kind: 'diff', diffStyle: 'unified' },
  ];
  const preferences = [
    {
      name: 'step 1: the first fully visible match wins',
      visible: true,
      below: true,
      line: 4011,
    },
    {
      name: 'step 2: a match below the viewport beats one in the upper buffer',
      visible: false,
      below: true,
      line: 4046,
    },
    {
      name: 'step 3: no match at or below the viewport wraps to the very first',
      visible: false,
      below: false,
      line: 101,
    },
  ];
  for (const { kind, diffStyle } of views) {
    for (const preference of preferences) {
      test(`${kind} ${diffStyle} ${preference.name}`, async () => {
        const lines = Array.from(
          { length: 6000 },
          (_, index) => `blank ${index}`
        );
        lines[100] = 'target first';
        lines[3995] = 'target upper buffer';
        if (preference.visible) lines[4010] = 'target visible';
        if (preference.below) lines[4045] = 'target lower buffer';
        const contents = lines.join('\n');
        const item: CodeViewItem<undefined> =
          kind === 'file'
            ? { id: 'item', type: 'file', file: { name: 'item.txt', contents } }
            : {
                id: 'item',
                type: 'diff',
                fileDiff: parseDiffFromFile(
                  { name: 'item.txt', contents },
                  {
                    name: 'item.txt',
                    contents: lines.map((line) => `${line} changed`).join('\n'),
                  },
                  {
                    disableLineMatching: true,
                    preferredDiffLib: '@pierre/patches',
                  }
                ),
              };
        await withViewer(
          [item],
          async ({ viewer, root }) => {
            viewer.scrollTo({
              type: 'line',
              id: 'item',
              lineNumber: 4001,
              side: 'additions',
              align: 'start',
              behavior: 'instant',
            });
            viewer.render(true);
            await wait(0);
            const itemRoot = viewer.getRenderedItems()[0]?.element.shadowRoot;
            if (itemRoot == null)
              throw new Error('Expected rendered search item');
            expect(itemRoot.querySelector('[data-line="3996"]')).not.toBeNull();
            expect(itemRoot.querySelector('[data-line="4046"]')).not.toBeNull();
            fillSearch(root, 'target');
            expect(getSearchState(viewer).current?.itemId).toBe('item');
            expect(getSearchState(viewer).current?.lineNumber).toBe(
              preference.line
            );
          },
          { diffStyle }
        );
      });
    }
  }

  for (const diffStyle of diffStyles) {
    const kinds: ('file' | 'diff')[] = ['file', 'diff'];
    for (const kind of kinds) {
      test(`${kind} ${diffStyle} selects at the anchor after thousands of matches in one item`, async () => {
        await withViewer(
          [makeItem(kind, 'item')],
          async ({ viewer, root }) => {
            viewer.scrollTo({
              type: 'line',
              id: 'item',
              lineNumber: 4001,
              side: 'additions',
              align: 'start',
              behavior: 'instant',
            });
            viewer.render(true);
            await wait(0);
            fillSearch(root, 'target');
            expect(getSearchState(viewer).current?.itemId).toBe('item');
            expect(getSearchState(viewer).current?.lineNumber).toBe(4001);
            if (kind === 'diff')
              expect(getSearchState(viewer).current?.side).toBe(
                diffStyle === 'split' ? 'deletions' : 'additions'
              );
          },
          { diffStyle }
        );
      });

      test(`${kind} ${diffStyle} starts after thousands of matches in preceding items`, async () => {
        const items = Array.from({ length: 20 }, (_, index) =>
          makeItem(kind, `item-${index}`, 400)
        );
        await withViewer(
          items,
          async ({ viewer, root }) => {
            viewer.scrollTo({
              type: 'line',
              id: 'item-15',
              lineNumber: 201,
              side: 'additions',
              align: 'start',
              behavior: 'instant',
            });
            viewer.render(true);
            await wait(0);
            fillSearch(root, 'target');
            expect(getSearchState(viewer).current?.itemId).toBe('item-15');
            expect(getSearchState(viewer).current?.lineNumber).toBe(201);
          },
          { diffStyle }
        );
      });

      test(`${kind} ${diffStyle} ignores a dense overscan item above the viewport`, async () => {
        await withViewer(
          [makeItem(kind, 'before'), makeItem(kind, 'edge', 100)],
          async ({ viewer, root }) => {
            viewer.scrollTo({
              type: 'line',
              id: 'edge',
              lineNumber: 1,
              side: kind === 'diff' ? 'deletions' : 'additions',
              align: 'start',
              behavior: 'instant',
            });
            viewer.render(true);
            await wait(0);
            expect(
              viewer.getRenderedItems().some(({ id }) => id === 'before')
            ).toBe(true);
            fillSearch(root, 'target');
            expect(getSearchState(viewer).current?.itemId).toBe('edge');
            expect(getSearchState(viewer).current?.lineNumber).toBe(1);
          },
          { diffStyle }
        );
      });
    }

    test(`${diffStyle} deletion-side viewport anchors retain deletion-before-addition ties`, async () => {
      await withViewer(
        [makeItem('diff', 'item')],
        async ({ viewer, root }) => {
          viewer.scrollTo({
            type: 'line',
            id: 'item',
            lineNumber: 4001,
            side: 'deletions',
            align: 'start',
            behavior: 'instant',
          });
          viewer.render(true);
          await wait(0);
          fillSearch(root, 'target');
          expect(getSearchState(viewer).current?.lineNumber).toBe(4001);
          expect(getSearchState(viewer).current?.side).toBe('deletions');
        },
        { diffStyle }
      );
    });

    test(`${diffStyle} pure rows agree with full, hidden, partial and scoped edited walks`, async () => {
      const item = makeItem('diff', 'item', 200);
      if (item.type !== 'diff') throw new Error('Expected diff');
      checkDiffRows(item.fileDiff, diffStyle);
      const lines = Array.from(
        { length: 200 },
        (_, index) => `target ${index}`
      );
      const changed = [...lines];
      changed[100] = 'target changed';
      const hidden = parseDiffFromFile(
        { name: 'context.txt', contents: lines.join('\n') },
        { name: 'context.txt', contents: changed.join('\n') }
      );
      checkDiffRows(hidden, diffStyle);
      const parsed = parsePatchFiles(
        'diff --git a/partial.txt b/partial.txt\n--- a/partial.txt\n+++ b/partial.txt\n@@ -10,3 +10,3 @@\n target before\n-target old\n+target new\n target after\n'
      );
      const partial = parsed[0]?.files[0];
      if (partial == null) throw new Error('Missing partial diff');
      checkDiffRows(partial, diffStyle);
      expect(getLineIndexForDiff(partial, 1, 'additions')).toBeDefined();
      expect(getLineIndexForDiff(partial, 100, 'deletions')).toBeDefined();
      await withViewer(
        [{ ...item, edit: true }],
        ({ viewer }) => {
          const editor = viewer.getEditor('item');
          const rendered = viewer
            .getRenderedItems()
            .find(({ id }) => id === 'item');
          if (editor == null || rendered?.type !== 'diff')
            throw new Error('Missing real diff editor');
          editor.applyEdits([
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 20, character: 0 },
              },
              newText: 'target inserted\n',
            },
          ]);
          const diff = rendered.instance.getDiffForSearch();
          if (diff == null) throw new Error('Missing searched session diff');
          checkDiffRows(diff, diffStyle, editor.getText());
          checkDiffRows(diff, diffStyle, editor.getText(), true);
          const document = editor.getEditState()?.document;
          if (document == null) throw new Error('Missing edited document');
          editor.applyEdits([
            {
              range: {
                start: { line: 0, character: 0 },
                end: document.positionAt(editor.getText().length),
              },
              newText: item.fileDiff.deletionLines.join(''),
            },
          ]);
          const unchanged = rendered.instance.getDiffForSearch();
          if (unchanged == null)
            throw new Error('Missing unchanged session diff');
          checkDiffRows(unchanged, diffStyle, editor.getText(), true);
        },
        { diffStyle }
      );
    });
  }
  for (const diffStyle of diffStyles) {
    const separatorTypes: ('simple' | 'metadata')[] = ['simple', 'metadata'];
    for (const hunkSeparators of separatorTypes) {
      test(`${diffStyle} ${hunkSeparators} hidden matches keep their searched rows`, async () => {
        const lines = Array.from(
          { length: 6000 },
          (_, index) => `target ${index}`
        );
        const next = [...lines];
        next[4000] = 'target changed';
        const diff = parseDiffFromFile(
          { name: 'hidden.txt', contents: lines.join('\n') },
          { name: 'hidden.txt', contents: next.join('\n') }
        );
        await withViewer(
          [
            { id: 'hidden', type: 'diff', fileDiff: diff },
            {
              id: 'padding',
              type: 'file',
              file: { name: 'padding.txt', contents: 'padding\n'.repeat(1000) },
            },
          ],
          async ({ viewer, root }) => {
            const item = viewer
              .getRenderedItems()
              .find(({ id }) => id === 'hidden');
            if (item?.type !== 'diff') throw new Error('Missing hidden diff');
            expect(
              item.instance.getLinePosition(6000, 'additions')
            ).toBeUndefined();
            expect(getLineIndexForDiff(diff, 6000, 'additions')).toEqual([
              6000, 5999,
            ]);
            viewer.scrollTo({
              type: 'line',
              id: 'hidden',
              lineNumber: 4001,
              side: 'deletions',
              align: 'start',
              behavior: 'instant',
            });
            viewer.render(true);
            await wait(0);
            fillSearch(root, 'target');
            expect(getSearchState(viewer).current?.itemId).toBe('hidden');
            expect(getSearchState(viewer).current?.lineNumber).toBe(4001);
            expect(getSearchState(viewer).current?.side).toBe('deletions');
          },
          { diffStyle, hunkSeparators }
        );
      });
    }
  }

  for (const diffStyle of diffStyles) {
    const separatorTypes: ('simple' | 'metadata')[] = ['simple', 'metadata'];
    for (const hunkSeparators of separatorTypes) {
      test(`${diffStyle} ${hunkSeparators} selects and reveals a hidden match below the anchor`, async () => {
        const lines = Array.from({ length: 6000 }, (_, index) =>
          index === 5000 ? 'target' : `line ${index}`
        );
        const next = [...lines];
        next[4000] = 'changed';
        const diff = parseDiffFromFile(
          { name: 'hidden-match.txt', contents: lines.join('\n') },
          { name: 'hidden-match.txt', contents: next.join('\n') }
        );
        await withViewer(
          [
            { id: 'hidden', type: 'diff', fileDiff: diff },
            {
              id: 'padding',
              type: 'file',
              file: { name: 'padding.txt', contents: 'padding\n'.repeat(1000) },
            },
          ],
          async ({ viewer, root, finish }) => {
            const item = viewer
              .getRenderedItems()
              .find(({ id }) => id === 'hidden');
            if (item?.type !== 'diff') throw new Error('Missing hidden diff');
            expect(
              item.instance.isLineInCollapsedContext(5001, 'additions')
            ).toBe(true);
            expect(
              item.instance.getLinePosition(5001, 'additions')
            ).toBeUndefined();
            viewer.scrollTo({
              type: 'line',
              id: 'hidden',
              lineNumber: 4001,
              side: 'deletions',
              align: 'start',
              behavior: 'instant',
            });
            viewer.render(true);
            await wait(0);
            fillSearch(root, 'target');
            await finish();
            expect(getSearchState(viewer).current?.lineNumber).toBe(5001);
            expect(
              item.instance.isLineInCollapsedContext(
                5001,
                getSearchState(viewer).current?.side
              )
            ).toBe(false);
          },
          { diffStyle, hunkSeparators }
        );
      });
    }
  }

  test('a collapsed file at an item anchor opens its first match', async () => {
    await withViewer(
      [
        {
          id: 'before',
          type: 'file',
          file: { name: 'before.txt', contents: 'blank\n'.repeat(100) },
        },
        { ...makeItem('file', 'collapsed'), collapsed: true },
        {
          id: 'after',
          type: 'file',
          file: { name: 'after.txt', contents: 'blank\n'.repeat(1000) },
        },
      ],
      async ({ viewer, root, finish }) => {
        const top = viewer.getTopForItem('collapsed');
        if (top == null) throw new Error('Missing collapsed item top');
        viewer.scrollTo({
          type: 'position',
          position: top,
          behavior: 'instant',
        });
        viewer.render(true);
        await wait(0);
        fillSearch(root, 'target');
        await finish();
        expect(getSearchState(viewer).current?.itemId).toBe('collapsed');
        expect(getSearchState(viewer).current?.lineNumber).toBe(1);
        expect(viewer.getItem('collapsed')?.collapsed).toBe(false);
      },
      { stickyHeaders: false }
    );
  });

  test('without a viewport anchor the first item supplies the starting match', async () => {
    await withViewer(
      [makeItem('file', 'first'), makeItem('file', 'later')],
      ({ viewer, root }) => {
        expect(root.scrollTop).toBe(0);
        fillSearch(root, 'target');
        expect(getSearchState(viewer).current?.itemId).toBe('first');
        expect(getSearchState(viewer).current?.lineNumber).toBe(1);
      }
    );
  });

  test('a pending edge item blocks a known earlier match until wrap is certain', async () => {
    const blank = `blank ${'x'.repeat(80)}\n`.repeat(2000);
    await withViewer(
      [
        {
          id: 'before',
          type: 'file',
          file: {
            name: 'before.txt',
            contents: `target\n${'blank\n'.repeat(40)}`,
          },
        },
        {
          id: 'edge',
          type: 'file',
          file: { name: 'edge.txt', contents: blank },
        },
        {
          id: 'after',
          type: 'file',
          file: { name: 'after.txt', contents: blank },
        },
      ],
      async ({ viewer, root, states, slice, finish }) => {
        viewer.scrollTo({
          type: 'line',
          id: 'edge',
          lineNumber: 1,
          align: 'start',
          behavior: 'instant',
        });
        viewer.render(true);
        await wait(0);
        slice();
        fillSearch(root, 'target');
        expect(states.at(-1)?.searching).toBe(true);
        expect(getSearchState(viewer).matches).toHaveLength(1);
        expect(getSearchState(viewer).current).toBeUndefined();
        await finish();
        expect(
          states
            .filter(({ searching, text }) => searching && text === 'target')
            .every(({ currentMatchIndex }) => currentMatchIndex == null)
        ).toBe(true);
        expect(getSearchState(viewer).current?.itemId).toBe('before');
      }
    );
  });

  test('a same-tick displayed/input swap uses the searched diff without throwing', async () => {
    const lines = Array.from({ length: 100 }, (_, index) => `target ${index}`);
    const initial = [...lines];
    initial[10] = 'target changed';
    const oldDiff = parseDiffFromFile(
      { name: 'swap.txt', contents: lines.join('\n') },
      { name: 'swap.txt', contents: initial.join('\n') }
    );
    const changed = [...initial];
    changed.splice(5, 0, 'target inserted one', 'target inserted two');
    const newDiff = parseDiffFromFile(
      { name: 'swap.txt', contents: lines.join('\n') },
      { name: 'swap.txt', contents: changed.join('\n') }
    );
    await withViewer(
      [{ id: 'swap', type: 'diff', fileDiff: oldDiff }],
      async ({ viewer, root }) => {
        viewer.scrollTo({
          type: 'line',
          id: 'swap',
          lineNumber: 12,
          side: 'additions',
          align: 'start',
          behavior: 'instant',
        });
        viewer.render(true);
        await wait(0);
        const item = viewer.getRenderedItems().find(({ id }) => id === 'swap');
        if (item?.type !== 'diff') throw new Error('Missing swap diff');
        viewer.updateItem({
          id: 'swap',
          type: 'diff',
          fileDiff: newDiff,
          version: 1,
        });
        expect(item.instance.getLineIndex(12, 'additions')).toEqual([12, 11]);
        expect(getLineIndexForDiff(newDiff, 12, 'additions')).toEqual([11, 11]);
        expect(() => fillSearch(root, 'target')).not.toThrow();
        expect(getSearchState(viewer).current?.itemId).toBe('swap');
        expect(
          getSearchState(viewer).matches.some(
            ({ side, lineNumber }) => side === 'additions' && lineNumber === 102
          )
        ).toBe(true);
      },
      { diffStyle: 'unified' }
    );
  });

  test('a scoped edited file keeps its source lines ordered', async () => {
    await withViewer(
      [{ ...makeItem('file', 'edited', 100), edit: true }],
      async ({ viewer, finish }) => {
        const editor = viewer.getEditor('edited');
        if (editor == null) throw new Error('Missing file editor');
        editor.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 20, character: 0 },
            },
            newText: 'target inserted\n',
          },
        ]);
        viewer.openSearch({ query: 'target', scope: { itemId: 'edited' } });
        await finish();
        const matches = getSearchState(viewer).matches;
        expect(matches).toHaveLength(81);
        let previous = 0;
        for (const match of matches) {
          expect(match.lineNumber).toBeGreaterThanOrEqual(previous);
          expect(match.lineIndex).toBe(match.lineNumber - 1);
          previous = match.lineNumber;
        }
      }
    );
  });
});
