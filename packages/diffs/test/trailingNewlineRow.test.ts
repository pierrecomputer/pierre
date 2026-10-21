import { afterAll, describe, expect, test } from 'bun:test';
import type { ElementContent, Element as HASTElement } from 'hast';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  parseDiffFromFile,
  parsePatchFiles,
} from '../src';
import type { FileDiffMetadata } from '../src/types';
import { finishEditSessionForDiff } from '../src/utils/editSessionHunks';
import {
  type DiffLineCallbackProps,
  endsWithNewline,
  iterateOverDiff,
} from '../src/utils/iterateOverDiff';

afterAll(async () => {
  await disposeHighlighter();
});

// A diff whose last change reaches the end of files that both end with a
// newline.
function makeDiffEndingInChange(): FileDiffMetadata {
  return parseDiffFromFile(
    { name: 'a.ts', contents: 'one\ntwo\nthree\n' },
    { name: 'a.ts', contents: 'one\ntwo\nTHREE\n' }
  );
}

// Only the new file ends with a newline.
function makeDiffAddingFinalNewline(): FileDiffMetadata {
  return parseDiffFromFile(
    { name: 'a.ts', contents: 'one\ntwo' },
    { name: 'a.ts', contents: 'one\nTWO\n' }
  );
}

// Neither file ends with a newline.
function makeDiffWithoutFinalNewline(): FileDiffMetadata {
  return parseDiffFromFile(
    { name: 'a.ts', contents: 'one\ntwo' },
    { name: 'a.ts', contents: 'one\nTWO' }
  );
}

// A partial diff from a patch whose only hunk starts at line 10. With
// `noNewline`, the patch marks its last line "\ No newline at end of file".
function makePartialDiff(noNewline: boolean): FileDiffMetadata {
  const patch = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -10,3 +10,3 @@',
    ' ten',
    '-eleven',
    '+ELEVEN',
    ' twelve',
    ...(noNewline ? ['\\ No newline at end of file'] : []),
    '',
  ].join('\n');
  const diff = parsePatchFiles(patch)[0]?.files[0];
  if (diff == null) {
    throw new Error('makePartialDiff: patch did not parse');
  }
  return diff;
}

// A diff with a long unchanged tail, so the end of the file is collapsed.
function makeDiffWithCollapsedTail(): FileDiffMetadata {
  const tail = Array.from({ length: 40 }, (_, index) => `tail ${index}\n`);
  return parseDiffFromFile(
    { name: 'a.ts', contents: ['first\n', ...tail].join('') },
    { name: 'a.ts', contents: ['FIRST\n', ...tail].join('') }
  );
}

function collectRows(
  diff: FileDiffMetadata,
  options: {
    includeTrailingNewline: boolean;
    expandedHunks?: true;
    diffStyle?: 'split' | 'unified';
  }
): DiffLineCallbackProps[] {
  const rows: DiffLineCallbackProps[] = [];
  iterateOverDiff({
    diff,
    diffStyle: options.diffStyle ?? 'split',
    expandedHunks: options.expandedHunks,
    includeTrailingNewline: options.includeTrailingNewline,
    callback: (row) => {
      rows.push(row);
    },
  });
  return rows;
}

// Whether a walk emitted a row past the new file's last line.
function hasTrailingRow(
  diff: FileDiffMetadata,
  rows: DiffLineCallbackProps[]
): boolean {
  return rows.some(
    (row) => row.additionLine?.lineIndex === diff.additionLines.length
  );
}

function lastElement(
  content: ElementContent[] | undefined
): HASTElement | undefined {
  const last = content?.at(-1);
  return last?.type === 'element' ? last : undefined;
}

describe('trailing newline row', () => {
  test('is context on both sides when both files end with a newline', () => {
    const diff = makeDiffEndingInChange();
    const finalRow = collectRows(diff, { includeTrailingNewline: true }).at(-1);
    expect(finalRow?.type).toBe('context');
    expect(finalRow?.deletionLine).toEqual({
      lineIndex: 3,
      lineNumber: 4,
      unifiedLineIndex: diff.unifiedLineCount,
      splitLineIndex: diff.splitLineCount,
      noEOFCR: false,
    });
    expect(finalRow?.additionLine).toEqual({
      lineIndex: 3,
      lineNumber: 4,
      unifiedLineIndex: diff.unifiedLineCount,
      splitLineIndex: diff.splitLineCount,
      noEOFCR: false,
    });
  });

  test('is an addition when only the new file ends with a newline', () => {
    const diff = makeDiffAddingFinalNewline();
    const finalRow = collectRows(diff, { includeTrailingNewline: true }).at(-1);
    expect(finalRow?.type).toBe('change');
    expect(finalRow?.deletionLine).toBeUndefined();
    expect(finalRow?.additionLine?.lineNumber).toBe(3);
  });

  test('is not emitted when the new file has no final newline', () => {
    const diff = makeDiffWithoutFinalNewline();
    expect(endsWithNewline(diff, 'additions')).toBe(false);
    expect(
      hasTrailingRow(diff, collectRows(diff, { includeTrailingNewline: true }))
    ).toBe(false);
  });

  test('is emitted by a walk whose window starts at it', () => {
    const diff = makeDiffEndingInChange();
    const rows: DiffLineCallbackProps[] = [];
    iterateOverDiff({
      diff,
      diffStyle: 'split',
      startingLine: diff.splitLineCount,
      totalLines: 1,
      includeTrailingNewline: true,
      callback: (row) => {
        rows.push(row);
      },
    });
    expect(rows.map((row) => row.additionLine?.lineNumber)).toEqual([4]);
  });

  test('follows the last hunk of a partial diff', () => {
    const diff = makePartialDiff(false);
    expect(diff.isPartial).toBe(true);
    const finalRow = collectRows(diff, { includeTrailingNewline: true }).at(-1);
    expect(finalRow?.type).toBe('context');
    expect(finalRow?.deletionLine?.lineNumber).toBe(13);
    expect(finalRow?.additionLine?.lineNumber).toBe(13);
    expect(finalRow?.additionLine?.lineIndex).toBe(diff.additionLines.length);
  });

  test('reads a partial diff\'s "No newline" marker', () => {
    const diff = makePartialDiff(true);
    expect(endsWithNewline(diff, 'additions')).toBe(false);
    expect(
      hasTrailingRow(diff, collectRows(diff, { includeTrailingNewline: true }))
    ).toBe(false);
  });

  test('is not emitted unless the walk asks for it', () => {
    const diff = makeDiffEndingInChange();
    expect(
      hasTrailingRow(diff, collectRows(diff, { includeTrailingNewline: false }))
    ).toBe(false);
  });

  test('stays hidden while the end of the file is collapsed', () => {
    const diff = makeDiffWithCollapsedTail();
    expect(
      hasTrailingRow(diff, collectRows(diff, { includeTrailingNewline: true }))
    ).toBe(false);
    expect(
      hasTrailingRow(
        diff,
        collectRows(diff, { includeTrailingNewline: true, expandedHunks: true })
      )
    ).toBe(true);
  });

  test('never leaks into the diff committed at session end', () => {
    const oldContents = ['drop 1', 'kept', 'drop 2', ''].join('\n');
    const diff = parseDiffFromFile(
      { name: 'a.ts', contents: oldContents },
      { name: 'a.ts', contents: 'kept\n' },
      { context: 3 }
    );
    const clean = parseDiffFromFile(
      { name: 'a.ts', contents: oldContents },
      { name: 'a.ts', contents: 'kept\n' },
      { context: 3 }
    );
    // Editor-shaped lines: the document ends with a newline, so the editor has
    // an empty final line.
    diff.additionLines = ['kept\n', ''];
    diff.editSessionDirty = true;

    finishEditSessionForDiff(diff, { context: 3 });

    expect(diff.additionLines).toEqual(clean.additionLines);
    expect(diff.unifiedLineCount).toBe(clean.unifiedLineCount);
    expect(diff.splitLineCount).toBe(clean.splitLineCount);
    expect(diff.hunks.map((hunk) => hunk.hunkContent)).toEqual(
      clean.hunks.map((hunk) => hunk.hunkContent)
    );
  });

  test('the walk still reports "No newline" lines', () => {
    const diff = makeDiffWithoutFinalNewline();
    expect(
      collectRows(diff, { includeTrailingNewline: true }).some(
        (row) =>
          row.additionLine?.noEOFCR === true ||
          row.deletionLine?.noEOFCR === true
      )
    ).toBe(true);
  });

  for (const diffStyle of ['split', 'unified'] as const) {
    test(`edit sessions hide "No newline" markers (${diffStyle})`, async () => {
      const renderer = new DiffHunksRenderer({
        theme: 'github-light',
        diffStyle,
      });
      const diff = makeDiffWithoutFinalNewline();
      await renderer.asyncRender(diff);
      const html = () => {
        const result = renderer.renderDiff(diff);
        return result == null ? '' : renderer.renderFullHTML(result);
      };
      expect(html()).toContain('data-no-newline');
      renderer.beginEditSession(diff);
      expect(html()).not.toContain('data-no-newline');
      renderer.endEditSession();
      expect(html()).toContain('data-no-newline');
    });
  }

  for (const diffStyle of ['split', 'unified'] as const) {
    test(`edit sessions render it as an empty context row (${diffStyle})`, async () => {
      const renderer = new DiffHunksRenderer({
        theme: 'github-light',
        diffStyle,
      });
      const diff = makeDiffEndingInChange();
      await renderer.asyncRender(diff);
      renderer.beginEditSession(diff);
      const result = renderer.renderDiff(diff);
      expect(result).toBeDefined();
      if (result == null) return;

      const row = lastElement(
        diffStyle === 'split'
          ? result.additionsContentAST
          : result.unifiedContentAST
      );
      expect(row?.properties['data-line']).toBe(4);
      expect(row?.properties['data-line-type']).toBe('context');
      if (diffStyle === 'split') {
        const deletionRow = lastElement(result.deletionsContentAST);
        expect(deletionRow?.properties['data-line']).toBe(4);
        expect(deletionRow?.properties['data-line-type']).toBe('context');
      }

      renderer.endEditSession();
      const viewResult = renderer.renderDiff(diff);
      const viewRow = lastElement(
        diffStyle === 'split'
          ? viewResult?.additionsContentAST
          : viewResult?.unifiedContentAST
      );
      expect(viewRow?.properties['data-line']).toBe(3);
    });
  }

  test('edit-mode entry only changes markup whose range reaches the end', () => {
    const renderer = new DiffHunksRenderer({
      theme: 'github-light',
      diffStyle: 'split',
    });
    const diff = makeDiffEndingInChange();
    const range = (startingLine: number, totalLines: number) => ({
      startingLine,
      totalLines,
      bufferBefore: 0,
      bufferAfter: 0,
    });
    expect(renderer.editingChangesEndOfFile(diff, undefined)).toBe(true);
    expect(renderer.editingChangesEndOfFile(diff, range(0, 3))).toBe(true);
    expect(renderer.editingChangesEndOfFile(diff, range(1, 2))).toBe(true);
    expect(renderer.editingChangesEndOfFile(diff, range(0, 2))).toBe(false);
  });

  test('edit sessions render it as an addition when the old file lacks a final newline', async () => {
    const renderer = new DiffHunksRenderer({
      theme: 'github-light',
      diffStyle: 'split',
    });
    const diff = makeDiffAddingFinalNewline();
    await renderer.asyncRender(diff);
    renderer.beginEditSession(diff);
    const result = renderer.renderDiff(diff);
    expect(result).toBeDefined();
    if (result == null) return;
    const row = lastElement(result.additionsContentAST);
    expect(row?.properties['data-line']).toBe(3);
    expect(row?.properties['data-line-type']).toBe('change-addition');
    expect(
      lastElement(result.deletionsContentAST)?.properties['data-content-buffer']
    ).toBeDefined();
  });
});
