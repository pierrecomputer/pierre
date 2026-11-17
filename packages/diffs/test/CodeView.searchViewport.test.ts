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
import { fillSearch, getSearchState } from './codeViewSearchHarness';
import {
  createRoot,
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
