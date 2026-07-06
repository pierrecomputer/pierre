import { afterAll, describe, expect, test } from 'bun:test';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  parseDiffFromFile,
} from '../src';
import { TextDocument } from '../src/editor/textDocument';
import type { DiffsTextDocument, HighlightedToken } from '../src/types';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';

afterAll(async () => {
  await disposeHighlighter();
});

const OLD_CONTENTS = [
  'function greet(name) {',
  '  const msg = "hi";',
  '  console.log(msg);',
  '  return msg;',
  '}',
  '',
].join('\n');
const NEW_CONTENTS = [
  'function greet(name) {',
  '  console.log(msg);',
  '  return msg;',
  '}',
  '',
].join('\n');

// Addition-side document after pressing Enter in the middle of
// "  console.log(msg);" (index 1), splitting it into two lines.
const EDITED_LINES = [
  'function greet(name) {',
  '  console.log(',
  'msg);',
  '  return msg;',
  '}',
  '',
];
// The tokenizer reports the truncated line and the new line as dirty, using the
// post-edit line indexes.

function makeTextDocumentFromText(text: string): DiffsTextDocument {
  return new TextDocument('edit.ts', text, 'typescript', 0);
}

function makeDirtyLines(
  edits: ReadonlyArray<[number, string]>
): Map<number, HighlightedToken[]> {
  const dirty = new Map<number, HighlightedToken[]>();
  for (const [line, lineText] of edits) {
    // A single plain-text token (char 0, empty fg) renders as a text node.
    dirty.set(line, [[0, '', lineText]]);
  }
  return dirty;
}

function makeTextDocument(lines: string[]): DiffsTextDocument {
  const text = lines.join('\n');
  return {
    lineCount: lines.length,
    getText: () => text,
    getLineText: (lineNumber: number) => lines[lineNumber] ?? '',
  };
}

// Builds a renderer with a populated (highlighted) render cache, mirroring the
// state the editor operates on mid-session.
async function createPrimedRenderer(
  diffStyle: 'split' | 'unified' = 'split'
): Promise<DiffHunksRenderer> {
  const renderer = new DiffHunksRenderer({ theme: 'github-light', diffStyle });
  const diff = parseDiffFromFile(
    { name: 'greet.ts', contents: OLD_CONTENTS, cacheKey: 'greet:old' },
    { name: 'greet.ts', contents: NEW_CONTENTS, cacheKey: 'greet:new' }
  );
  await renderer.asyncRender(diff);
  renderer.renderDiff(diff);
  return renderer;
}

describe('DiffHunksRenderer content-edit recompute split', () => {
  test('updateRenderCache recomputes hunk metadata for changed addition lines', async () => {
    const renderer = await createPrimedRenderer();
    const diffCache = renderer.diffCache;
    expect(diffCache).toBeDefined();
    if (diffCache == null) return;

    const hunksBefore = diffCache.hunks;
    // In-place edit of an existing line (no line-count change).
    renderer.updateRenderCache(
      makeDirtyLines([[1, '  console.log(msg) // edited']]),
      'light'
    );
    expect(diffCache.hunks).not.toBe(hunksBefore);
  });

  test('updateRenderCache matches a full recompute for a content-only edit', async () => {
    const split = await createPrimedRenderer();
    split.updateRenderCache(
      makeDirtyLines([[1, '  console.log(msg) // edited']]),
      'light'
    );
    const incremental = split.diffCache;

    // Expected result: a full re-parse of the same edited content from scratch.
    const full = parseDiffFromFile(
      { name: 'greet.ts', contents: OLD_CONTENTS, cacheKey: 'greet:old' },
      {
        name: 'greet.ts',
        contents: [
          'function greet(name) {',
          '  console.log(msg) // edited',
          '  return msg;',
          '}',
          '',
        ].join('\n'),
        cacheKey: 'greet:new:edited',
      }
    );

    expect(incremental).toBeDefined();
    if (incremental == null) return;
    expect(incremental.hunks).toEqual(full.hunks);
    expect(incremental.splitLineCount).toBe(full.splitLineCount);
    expect(incremental.unifiedLineCount).toBe(full.unifiedLineCount);
  });

  test('meaningful line-count edits preserve unchanged context', async () => {
    const renderer = await createPrimedRenderer('split');

    renderer.applyDocumentChange(
      makeTextDocumentFromText(EDITED_LINES.join('\n'))
    );

    const rendered = renderer.diffCache;
    expect(rendered).toBeDefined();
    if (rendered == null) return;

    expect(
      rendered.hunks.some((hunk) =>
        hunk.hunkContent.some((content) => content.type === 'context')
      )
    ).toBe(true);

    let firstLine:
      | {
          type: string;
          deletionLineNumber?: number;
          additionLineNumber?: number;
        }
      | undefined;
    iterateOverDiff({
      diff: rendered,
      diffStyle: 'split',
      callback: ({ type, deletionLine, additionLine }) => {
        firstLine ??= {
          type,
          deletionLineNumber: deletionLine?.lineNumber,
          additionLineNumber: additionLine?.lineNumber,
        };
      },
    });

    expect(firstLine).toEqual({
      type: 'context',
      deletionLineNumber: 1,
      additionLineNumber: 1,
    });
  });
});

// Deleting every character empties the editor's document, whose text is "".
// splitFileContents("") is [], so a naive recompute drops the addition side to
// zero lines — but the editor always keeps one (empty) line, so the addition
// column must keep one empty editable row. Without it the attached editor has
// no element to host its caret: the additions column disappears entirely in
// split (an uneditable view) and unified renders only deletions (nothing to
// type into).
describe('DiffHunksRenderer.applyDocumentChange empty document', () => {
  // The editor reports a single empty line for an emptied document ([''] joins
  // to "", the editor's empty text).
  const EMPTY_DOCUMENT = makeTextDocument(['']);

  for (const diffStyle of ['split', 'unified'] as const) {
    test(`keeps one empty editable addition line (${diffStyle})`, async () => {
      const renderer = await createPrimedRenderer(diffStyle);
      renderer.applyDocumentChange(EMPTY_DOCUMENT);

      const diff = renderer.diffCache;
      expect(diff).toBeDefined();
      if (diff == null) return;

      // One empty line, not zero — this is the regression guard.
      expect(diff.additionLines).toEqual(['']);
      // The old content is still the deletion side.
      expect(diff.deletionLines.length).toBeGreaterThan(0);

      // The diff must still render (a zero-addition diff threw mid-render).
      const result = renderer.renderDiff();
      expect(result).toBeDefined();
      if (result == null) return;
      const html = renderer.renderFullHTML(result);
      // The editable addition line is emitted as an added change row.
      expect(html).toContain('change-addition');
    });

    test(`top-aligns the empty addition line in split view (${diffStyle})`, async () => {
      const oldContents =
        Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join(
          '\n'
        ) + '\n';
      const newContents =
        Array.from({ length: 60 }, (_, index) => `new ${index + 1}`).join(
          '\n'
        ) + '\n';
      const renderer = new DiffHunksRenderer({
        theme: 'github-light',
        diffStyle,
      });
      const diff = parseDiffFromFile(
        { name: 'old.ts', contents: oldContents, cacheKey: 'old:empty-base' },
        { name: 'new.ts', contents: newContents, cacheKey: 'new:empty-base' }
      );
      await renderer.asyncRender(diff);
      renderer.renderDiff(diff);
      renderer.applyDocumentChange(EMPTY_DOCUMENT);

      const rendered = renderer.diffCache;
      expect(rendered).toBeDefined();
      if (rendered == null) return;

      let firstAdditionSplitLine: number | undefined;
      iterateOverDiff({
        diff: rendered,
        diffStyle: 'split',
        callback: ({ additionLine }) => {
          if (firstAdditionSplitLine === undefined && additionLine != null) {
            firstAdditionSplitLine = additionLine.splitLineIndex;
          }
        },
      });
      expect(firstAdditionSplitLine).toBe(0);
    });

    test(`top-aligns newline-only additions after delete-all (${diffStyle})`, async () => {
      const oldContents =
        Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join(
          '\n'
        ) + '\n';
      const newContents =
        Array.from({ length: 60 }, (_, index) => `new ${index + 1}`).join(
          '\n'
        ) + '\n';
      const renderer = new DiffHunksRenderer({
        theme: 'github-light',
        diffStyle,
      });
      const diff = parseDiffFromFile(
        {
          name: 'old.ts',
          contents: oldContents,
          cacheKey: 'old:newline-base',
        },
        {
          name: 'new.ts',
          contents: newContents,
          cacheKey: 'new:newline-base',
        }
      );
      await renderer.asyncRender(diff);
      renderer.renderDiff(diff);
      renderer.applyDocumentChange(EMPTY_DOCUMENT);
      renderer.applyDocumentChange(makeTextDocumentFromText('\n'));

      const rendered = renderer.diffCache;
      expect(rendered).toBeDefined();
      if (rendered == null) return;

      const additionSplitLines: number[] = [];
      iterateOverDiff({
        diff: rendered,
        diffStyle: 'split',
        callback: ({ additionLine }) => {
          if (additionLine != null) {
            additionSplitLines.push(additionLine.splitLineIndex);
          }
        },
      });
      expect(additionSplitLines).toEqual([0, 1]);
    });

    test(`top-aligns multiple newline-only additions after delete-all (${diffStyle})`, async () => {
      const oldContents =
        Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join(
          '\n'
        ) + '\n';
      const newContents =
        Array.from({ length: 60 }, (_, index) => `new ${index + 1}`).join(
          '\n'
        ) + '\n';
      const renderer = new DiffHunksRenderer({
        theme: 'github-light',
        diffStyle,
      });
      const diff = parseDiffFromFile(
        {
          name: 'old.ts',
          contents: oldContents,
          cacheKey: 'old:multi-newline-base',
        },
        {
          name: 'new.ts',
          contents: newContents,
          cacheKey: 'new:multi-newline-base',
        }
      );
      await renderer.asyncRender(diff);
      renderer.renderDiff(diff);
      renderer.applyDocumentChange(EMPTY_DOCUMENT);
      renderer.applyDocumentChange(makeTextDocumentFromText('\n\n'));

      const rendered = renderer.diffCache;
      expect(rendered).toBeDefined();
      if (rendered == null) return;

      const additionSplitLines: number[] = [];
      iterateOverDiff({
        diff: rendered,
        diffStyle: 'split',
        callback: ({ additionLine }) => {
          if (additionLine != null) {
            additionSplitLines.push(additionLine.splitLineIndex);
          }
        },
      });
      expect(additionSplitLines).toEqual([0, 1, 2]);
    });

    test(`renders one row per editor line after insertLineBreak (${diffStyle})`, async () => {
      const oldContents =
        Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join(
          '\n'
        ) + '\n';
      const newContents =
        Array.from({ length: 60 }, (_, index) => `new ${index + 1}`).join(
          '\n'
        ) + '\n';
      const renderer = new DiffHunksRenderer({
        theme: 'github-light',
        diffStyle,
      });
      const diff = parseDiffFromFile(
        {
          name: 'old.ts',
          contents: oldContents,
          cacheKey: 'old:insert-break-base',
        },
        {
          name: 'new.ts',
          contents: newContents,
          cacheKey: 'new:insert-break-base',
        }
      );
      await renderer.asyncRender(diff);
      renderer.renderDiff(diff);
      renderer.applyDocumentChange(EMPTY_DOCUMENT);
      renderer.applyDocumentChange(makeTextDocumentFromText('\n'));

      const rendered = renderer.diffCache;
      expect(rendered).toBeDefined();
      if (rendered == null) return;
      expect(rendered.additionLines).toEqual(['\n', '']);

      const additionSplitLines: number[] = [];
      iterateOverDiff({
        diff: rendered,
        diffStyle: 'split',
        callback: ({ additionLine }) => {
          if (additionLine != null) {
            additionSplitLines.push(additionLine.lineNumber);
          }
        },
      });
      expect(additionSplitLines).toEqual([1, 2]);
    });

    // When the old side is itself a single blank line, diffing the emptied
    // document against an empty line would be a no-op (zero hunks, so zero
    // rendered rows). The recompute must still produce one editable row.
    test(`keeps an editable line when the old side is one blank line (${diffStyle})`, async () => {
      const renderer = new DiffHunksRenderer({
        theme: 'github-light',
        diffStyle,
      });
      const diff = parseDiffFromFile(
        { name: 'blank.ts', contents: '\n', cacheKey: 'blank:old' },
        { name: 'blank.ts', contents: 'typed\n', cacheKey: 'blank:new' }
      );
      await renderer.asyncRender(diff);
      renderer.renderDiff(diff);

      renderer.applyDocumentChange(EMPTY_DOCUMENT);

      const rendered = renderer.diffCache;
      expect(rendered).toBeDefined();
      if (rendered == null) return;
      expect(rendered.additionLines).toEqual(['']);
      // The blank old line is still recorded as the deletion side.
      expect(rendered.deletionLines.join('')).toBe('\n');
      // At least one hunk, so iterateOverDiff has a row to emit.
      expect(rendered.hunks.length).toBeGreaterThanOrEqual(1);

      const result = renderer.renderDiff();
      expect(result).toBeDefined();
      if (result == null) return;
      expect(renderer.renderFullHTML(result)).toContain('change-addition');
    });
  }
});
