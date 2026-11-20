import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import {
  type CodeViewSearchItem,
  type CodeViewSearchMatch,
  CodeViewSearchScan,
  MAX_SEARCH_MATCHES,
} from '../src/search';
import type { SelectionSide } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { createRoot, installDom, renderItems } from './domHarness';

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
  wholeWord: false,
  caseSensitive: false,
};

// Searches one real item to completion.
function search(
  item: CodeViewSearchItem,
  limit = MAX_SEARCH_MATCHES
): CodeViewSearchScan {
  const scan = new CodeViewSearchScan(params, 1, () => item, limit);
  scan.advance();
  return scan;
}

// Reads a line span from the item's original match array.
function lineMatches(
  scan: CodeViewSearchScan,
  lineNumber: number,
  side?: SelectionSide
): CodeViewSearchMatch[] | undefined {
  const span = scan.getLineMatches(0, lineNumber, side);
  const matches = scan.getItemMatches(0);
  if (span == null || matches == null) return undefined;
  const line: CodeViewSearchMatch[] = [];
  for (let index = span.startIndex; index < span.endIndex; index++)
    line.push(matches[index]);
  return line;
}

describe('CodeView search line spans', () => {
  test('file line spans and source positions preserve multiple matches and gaps', () => {
    const item: CodeViewSearchItem = {
      itemId: 'file',
      type: 'file',
      contents: 'target target\nblank\nxx target\n\nlast target target',
    };
    const scan = search(item);
    const matches = scan.getMatches();
    expect(scan.getLineMatches(0, 1)).toEqual({
      lineNumber: 1,
      startIndex: 0,
      endIndex: 2,
    });
    expect(scan.getLineMatches(0, 2)).toBeUndefined();
    expect(scan.getLineMatches(0, 3)).toEqual({
      lineNumber: 3,
      startIndex: 2,
      endIndex: 3,
    });
    expect(scan.getLineMatches(0, 5)).toEqual({
      lineNumber: 5,
      startIndex: 3,
      endIndex: 5,
    });
    expect(lineMatches(scan, 1)).toEqual([matches[0], matches[1]]);
    expect(lineMatches(scan, 3)).toEqual([matches[2]]);
    expect(scan.getFirstMatchAtOrAfter(0, 1, 0)).toBe(matches[0]);
    expect(scan.getFirstMatchAtOrAfter(0, 1, 7)).toBe(matches[1]);
    expect(scan.getFirstMatchAtOrAfter(0, 1, 8)).toBe(matches[2]);
    expect(scan.getFirstMatchAtOrAfter(0, 2, 500)).toBe(matches[2]);
    expect(scan.getFirstMatchAtOrAfter(0, 5, 100)).toBeUndefined();
    const restarted = search(item);
    expect(restarted.getMatches()[4]).not.toBe(matches[4]);
    expect(restarted.getMatchIndex(0, matches[4])).toBe(4);
    expect(
      restarted.getMatchIndex(0, { ...matches[4], endCharacter: 99 })
    ).toBeUndefined();
    expect(
      restarted.getMatchIndex(0, { ...matches[4], lineNumber: 4, lineIndex: 3 })
    ).toBeUndefined();
  });

  const styles: ('split' | 'unified')[] = ['split', 'unified'];
  for (const diffStyle of styles) {
    test(`${diffStyle} spans keep deletion and addition lines separate`, () => {
      const fileDiff = parseDiffFromFile(
        { name: 'diff.txt', contents: 'target old target\nkeep\nlast target' },
        { name: 'diff.txt', contents: 'target new target\nkeep\nlast target' },
        { disableLineMatching: true }
      );
      const item: CodeViewSearchItem = {
        itemId: 'diff',
        type: 'diff',
        fileDiff,
        diffStyle,
        additionsOnly: false,
      };
      const scan = search(item);
      const matches = scan.getMatches();
      expect(scan.getLineMatches(0, 1, 'deletions')).toEqual({
        lineNumber: 1,
        startIndex: 0,
        endIndex: 2,
      });
      expect(scan.getLineMatches(0, 1, 'additions')).toEqual({
        lineNumber: 1,
        startIndex: 2,
        endIndex: 4,
      });
      expect(lineMatches(scan, 1, 'deletions')).toEqual([
        matches[0],
        matches[1],
      ]);
      expect(lineMatches(scan, 1, 'additions')).toEqual([
        matches[2],
        matches[3],
      ]);
      expect(scan.getFirstMatchAtOrAfter(0, 1, 6, 'deletions')).toBe(
        matches[1]
      );
      expect(scan.getFirstMatchAtOrAfter(0, 1, 12, 'deletions')).toBe(
        diffStyle === 'split' ? matches[4] : undefined
      );
      const lastAdditionIndex = diffStyle === 'split' ? 5 : 4;
      expect(scan.getFirstMatchAtOrAfter(0, 1, 12, 'additions')).toBe(
        matches[lastAdditionIndex]
      );
      expect(scan.getLineMatches(0, 3, 'additions')).toEqual({
        lineNumber: 3,
        startIndex: lastAdditionIndex,
        endIndex: lastAdditionIndex + 1,
      });
      expect(search(item).getMatchIndex(0, matches[lastAdditionIndex])).toBe(
        lastAdditionIndex
      );
      expect(search(item).getMatchIndex(0, matches[1])).toBe(1);
    });

    test(`${diffStyle} edited and scoped document spans remain ordered`, async () => {
      const dom = installDom();
      const viewer = new CodeView({
        diffStyle,
        useTokenTransformer: true,
        createEditor: (type, options, key) => new Editor(type, options, key),
      });
      try {
        const root = createRoot();
        viewer.setup(root);
        const before = Array.from(
          { length: 200 },
          (_, index) => `target old ${index} target`
        ).join('\n');
        const after = before.replaceAll('old', 'new');
        await renderItems(viewer, [
          {
            id: 'edited',
            type: 'diff',
            edit: true,
            fileDiff: parseDiffFromFile(
              { name: 'edited.txt', contents: before },
              { name: 'edited.txt', contents: after },
              { disableLineMatching: true }
            ),
          },
        ]);
        const editor = viewer.getEditor('edited');
        const rendered = viewer
          .getRenderedItems()
          .find(({ id }) => id === 'edited');
        if (editor == null || rendered?.type !== 'diff')
          throw new Error('Missing real diff editor');
        editor.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 20, character: 0 },
            },
            newText: 'target inserted target\n',
          },
        ]);
        const fileDiff = rendered.instance.getDiffForSearch();
        if (fileDiff == null) throw new Error('Missing searched diff');
        for (const additionsOnly of [false, true]) {
          if (additionsOnly)
            viewer.openSearch({ query: '', scope: { itemId: 'edited' } });
          const item: CodeViewSearchItem = {
            itemId: 'edited',
            type: 'diff',
            fileDiff,
            diffStyle,
            additionContents: editor.getText(),
            additionsOnly,
          };
          const scan = search(item);
          const restarted = search(item);
          const previous = new Map<
            SelectionSide | undefined,
            CodeViewSearchMatch
          >();
          const matches = scan.getMatches();
          for (const [index, match] of matches.entries()) {
            const last = previous.get(match.side);
            if (last != null) {
              expect(match.lineNumber).toBeGreaterThanOrEqual(last.lineNumber);
              if (last.lineNumber === match.lineNumber)
                expect(match.startCharacter).toBeGreaterThan(
                  last.startCharacter
                );
            }
            previous.set(match.side, match);
            const span = scan.getLineMatches(0, match.lineNumber, match.side);
            if (span == null) throw new Error('Missing matched line span');
            expect(span.startIndex <= index && index < span.endIndex).toBe(
              true
            );
            expect(
              scan.getFirstMatchAtOrAfter(
                0,
                match.lineNumber,
                match.startCharacter,
                match.side
              )
            ).toBe(match);
            expect(restarted.getMatchIndex(0, match)).toBe(index);
          }
        }
      } finally {
        viewer.cleanUp();
        dom.cleanup();
      }
    });
  }

  test('sparse matching lines skip the unmatched lines between them', () => {
    const contents = Array.from({ length: 100_001 }, (_, index) =>
      index % 1000 === 0 ? 'target' : 'padding'
    ).join('\n');
    const scan = search({ itemId: 'sparse', type: 'file', contents });
    const matches = scan.getMatches();
    expect(matches).toHaveLength(101);
    expect(scan.getLineMatches(0, 500)).toBeUndefined();
    expect(scan.getLineMatches(0, 50_001)).toEqual({
      lineNumber: 50_001,
      startIndex: 50,
      endIndex: 51,
    });
    expect(scan.getLineMatches(0, 100_001)).toEqual({
      lineNumber: 100_001,
      startIndex: 100,
      endIndex: 101,
    });
    expect(scan.getFirstMatchAtOrAfter(0, 500, 0)).toBe(matches[1]);
    expect(scan.getFirstMatchAtOrAfter(0, 50_001, 1)).toBe(matches[51]);
    expect(scan.getFirstMatchAtOrAfter(0, 100_002, 0)).toBeUndefined();
    expect(scan.getMatchIndex(0, { ...matches[100] })).toBe(100);
  });

  test('a cap inside a line records only its accepted match span', () => {
    const scan = search(
      {
        itemId: 'capped',
        type: 'file',
        contents: 'target target target\ntarget',
      },
      2
    );
    expect(scan.getLineMatches(0, 1)).toEqual({
      lineNumber: 1,
      startIndex: 0,
      endIndex: 2,
    });
    expect(scan.getLineMatches(0, 2)).toBeUndefined();
    expect(scan.getFirstMatchAtOrAfter(0, 1, 8)).toBeUndefined();
  });
});
