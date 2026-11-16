import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type { SearchPanelState } from '../src/search';
import type { CodeViewItem } from '../src/types';
import {
  fillSearch,
  getRenderedCurrentSearchMatches,
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

beforeAll(async () => {
  await getSharedHighlighter({
    themes: ['pierre-dark', 'pierre-light'],
    langs: ['text'],
    preferredHighlighter: 'shiki-js',
  });
});
afterAll(disposeHighlighter);

// Runs real CodeView searches; the clock only controls whether scanning yields.
async function withViewer(
  items: CodeViewItem<undefined>[],
  run: (context: {
    viewer: CodeView;
    root: HTMLElement;
    states: SearchPanelState[];
    slice(): void;
    finish(): Promise<void>;
  }) => Promise<void>
): Promise<void> {
  const dom = installDom();
  const states: SearchPanelState[] = [];
  const viewer = new CodeView({
    useTokenTransformer: true,
    createEditor: (type, options, key) => new Editor(type, options, key),
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

function label(root: HTMLElement): string | null | undefined {
  return getSearchPanelRoot(root).querySelector('[data-matches]')?.textContent;
}

// The current native highlight shows the source row chosen by navigation.
function currentLine(root: HTMLElement): number {
  const range = getRenderedCurrentSearchMatches(root)[0];
  const row =
    range?.startContainer.parentElement?.closest<HTMLElement>('[data-line]');
  return Number(row?.dataset.line);
}

describe('CodeView search indices', () => {
  test('next and previous keep first, middle, last and both wraps correct in a long list', async () => {
    const contents = Array.from(
      { length: 100_000 },
      (_, index) => `target ${index}`
    ).join('\n');
    await withViewer(
      [{ id: 'file', type: 'file', file: { name: 'large.txt', contents } }],
      async ({ viewer, root, states }) => {
        const expectCurrent = async (index: number) => {
          viewer.render(true);
          await wait(0);
          expect(states.at(-1)?.currentMatchIndex).toBe(index);
          expect(states.at(-1)?.matchCount).toBe(100_000);
          expect(getSearchState(viewer).current?.lineIndex).toBe(index);
          expect(label(root)).toBe(
            `${new Intl.NumberFormat('en-US').format(index + 1)} of 100,000`
          );
          expect(currentLine(root)).toBe(index + 1);
        };
        fillSearch(root, 'target');
        await expectCurrent(0);
        viewer.navigateSearch('next');
        await expectCurrent(1);
        viewer.navigateSearch('previous');
        await expectCurrent(0);
        viewer.navigateSearch('previous');
        await expectCurrent(99_999);
        viewer.navigateSearch('previous');
        await expectCurrent(99_998);
        viewer.navigateSearch('next');
        await expectCurrent(99_999);
        viewer.navigateSearch('next');
        await expectCurrent(0);
        fillSearch(root, '');
        viewer.scrollTo({
          type: 'line',
          id: 'file',
          lineNumber: 50_001,
          align: 'start',
          behavior: 'instant',
        });
        viewer.render(true);
        await wait(0);
        fillSearch(root, 'target');
        await expectCurrent(50_000);
        viewer.navigateSearch('next');
        await expectCurrent(50_001);
        viewer.navigateSearch('previous');
        await expectCurrent(50_000);
        viewer.navigateSearch('previous');
        await expectCurrent(49_999);
      }
    );
  });

  test('earlier arrivals and restarted scans update the index while retaining the chosen match', async () => {
    const before = (count: number): CodeViewItem<undefined> => ({
      id: 'before',
      type: 'file',
      file: {
        name: 'before.txt',
        contents: `${'target '.repeat(count)}\n${'blank\n'.repeat(200)}`,
      },
    });
    const edge = (
      contents = 'target '.repeat(40)
    ): CodeViewItem<undefined> => ({
      id: 'edge',
      type: 'file',
      file: {
        name: 'edge.txt',
        contents: `${'blank\n'.repeat(100)}${contents}\n${'blank\n'.repeat(200)}`,
      },
    });
    const after: CodeViewItem<undefined> = {
      id: 'after',
      type: 'file',
      file: {
        name: 'after.txt',
        contents: `blank ${'x'.repeat(80)}\n`.repeat(3000),
      },
    };
    await withViewer(
      [before(12), edge(), after],
      async ({ viewer, root, states, slice, finish }) => {
        viewer.scrollTo({
          type: 'line',
          id: 'edge',
          lineNumber: 101,
          align: 'start',
          behavior: 'instant',
        });
        viewer.render(true);
        await wait(0);
        slice();
        fillSearch(root, 'target');
        viewer.navigateSearch('next');
        viewer.navigateSearch('next');
        expect(states.at(-1)?.searching).toBe(true);
        expect(states.at(-1)?.currentMatchIndex).toBe(2);
        expect(label(root)).toBe('3 of 40');
        expect(getSearchState(viewer).current?.itemId).toBe('edge');
        expect(getSearchState(viewer).current?.startCharacter).toBe(14);
        await finish();
        expect(states.at(-1)?.currentMatchIndex).toBe(14);
        expect(label(root)).toBe('15 of 52');
        expect(getSearchState(viewer).current?.itemId).toBe('edge');
        expect(getSearchState(viewer).current?.startCharacter).toBe(14);
        viewer.updateItem({ ...before(24), version: 1 });
        viewer.render(true);
        await finish();
        expect(states.at(-1)?.currentMatchIndex).toBe(26);
        expect(label(root)).toBe('27 of 64');
        expect(getSearchState(viewer).current?.itemId).toBe('edge');
        expect(getSearchState(viewer).current?.startCharacter).toBe(14);
        viewer.updateItem({ ...edge('gone'), version: 1 });
        viewer.render(true);
        await finish();
        expect(states.at(-1)?.currentMatchIndex).toBeUndefined();
        expect(label(root)).toBe('24 results');
        expect(getSearchState(viewer).current).toBeUndefined();
        expect(getRenderedCurrentSearchMatches(root)).toHaveLength(0);
      }
    );
  });
  test('an editor edit removing the current match clears the index without navigating', async () => {
    await withViewer(
      [
        {
          id: 'edit',
          type: 'file',
          edit: true,
          file: {
            name: 'edit.txt',
            contents: 'target one\ntarget two\ntarget three',
          },
        },
      ],
      async ({ viewer, root, states, finish }) => {
        fillSearch(root, 'target');
        viewer.navigateSearch('next');
        expect(states.at(-1)?.currentMatchIndex).toBe(1);
        expect(label(root)).toBe('2 of 3');
        expect(getSearchState(viewer).current?.lineIndex).toBe(1);
        const editor = viewer.getEditor('edit');
        if (editor == null) throw new Error('Missing actual editor');
        editor.applyEdits([
          {
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 6 },
            },
            newText: 'gone',
          },
        ]);
        await finish();
        expect(editor.getText()).toBe('target one\ngone two\ntarget three');
        expect(states.at(-1)?.matchCount).toBe(2);
        expect(states.at(-1)?.currentMatchIndex).toBeUndefined();
        expect(label(root)).toBe('2 results');
        expect(getSearchState(viewer).current).toBeUndefined();
        expect(getRenderedCurrentSearchMatches(root)).toHaveLength(0);
      }
    );
  });
  test('finds distant matches and waits for unsearched items before choosing one', async () => {
    const pause = `blank ${'x'.repeat(80)}\n`.repeat(2000);
    const items: CodeViewItem<undefined>[] = Array.from(
      { length: 5001 },
      (_, position) => ({
        id: `item-${position}`,
        type: 'file',
        file: {
          name: `${position}.txt`,
          contents:
            position === 0 || position === 2500
              ? pause
              : position === 1000 || position === 4000
                ? 'target\nblank\nblank\nblank'
                : 'blank\nblank\nblank\nblank',
        },
      })
    );
    await withViewer(items, async ({ viewer, root, states, slice, finish }) => {
      viewer.scrollTo({
        type: 'line',
        id: 'item-2500',
        lineNumber: 1000,
        align: 'start',
        behavior: 'instant',
      });
      viewer.render(true);
      await wait(0);
      slice();
      fillSearch(root, 'target');
      expect(getSearchState(viewer).current).toBeUndefined();
      await finish();
      expect(getSearchState(viewer).current?.itemId).toBe('item-4000');
      expect(states.at(-1)?.currentMatchIndex).toBe(1);
      expect(label(root)).toBe('2 of 2');

      fillSearch(root, '');
      viewer.scrollTo({
        type: 'line',
        id: 'item-2500',
        lineNumber: 1000,
        align: 'start',
        behavior: 'instant',
      });
      viewer.render(true);
      await wait(0);
      const start = states.length;
      fillSearch(root, 'target');
      viewer.scrollTo({
        type: 'line',
        id: 'item-1000',
        lineNumber: 1,
        align: 'start',
        behavior: 'instant',
      });
      viewer.render(true);
      await finish();
      const partial = states
        .slice(start)
        .filter(({ searching, matchCount }) => searching && matchCount === 1);
      expect(partial.length).toBeGreaterThan(0);
      expect(
        partial.every(({ currentMatchIndex }) => currentMatchIndex == null)
      ).toBe(true);
      expect(getSearchState(viewer).current?.itemId).toBe('item-1000');
      expect(states.at(-1)?.currentMatchIndex).toBe(0);
      expect(label(root)).toBe('1 of 2');
    });
  });
});
