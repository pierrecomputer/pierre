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
const DIRTY_EDIT: ReadonlyArray<[number, string]> = [
  [1, '  console.log('],
  [2, 'msg);'],
];

function makeTextDocument(lines: string[]): DiffsTextDocument {
  const text = lines.join('\n');
  return {
    lineCount: lines.length,
    getText: () => text,
    getLineText: (lineNumber: number) => lines[lineNumber] ?? '',
  };
}

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
    { name: 'greet.ts', contents: OLD_CONTENTS },
    { name: 'greet.ts', contents: NEW_CONTENTS }
  );
  await renderer.asyncRender(diff);
  renderer.renderDiff(diff);
  return renderer;
}

describe('DiffHunksRenderer.updateRenderCache skipDiffRecompute', () => {
  test('baseline: without the skip flag, a line-count edit recomputes hunks twice', async () => {
    const renderer = await createPrimedRenderer();
    const cacheDiff = renderer.getDiffCache();
    expect(cacheDiff).toBeDefined();
    if (cacheDiff == null) return;
    // Sanity check the fixture is the unequal-length (recompute-fallback) case.
    expect(cacheDiff.additionLines.length).not.toBe(
      cacheDiff.deletionLines.length
    );

    const hunksBeforeUpdate = cacheDiff.hunks;
    renderer.updateRenderCache(makeDirtyLines(DIRTY_EDIT), 'light');
    // A fresh hunks array reference proves a full `recomputeDiffHunks` ran.
    expect(cacheDiff.hunks).not.toBe(hunksBeforeUpdate);

    const hunksAfterUpdate = cacheDiff.hunks;
    renderer.applyDocumentChange(makeTextDocument(EDITED_LINES));
    expect(renderer.getDiffCache()?.hunks).not.toBe(hunksAfterUpdate);
  });

  test('skip flag avoids the recompute in updateRenderCache', async () => {
    const renderer = await createPrimedRenderer();
    const cacheDiff = renderer.getDiffCache();
    expect(cacheDiff).toBeDefined();
    if (cacheDiff == null) return;

    const hunksBefore = cacheDiff.hunks;
    // In-place edit of an existing line (no line-count change).
    const changed = renderer.updateRenderCache(
      makeDirtyLines([[1, '  console.log(msg) // edited']]),
      'light'
    );
    // Token sync ran but hunks were NOT recomputed here.
    expect(cacheDiff.hunks).toBe(hunksBefore);
    expect([...changed]).toEqual([1]);
  });

  test('recomputeContentHunks matches a full recompute for a content-only edit', async () => {
    const split = await createPrimedRenderer();
    const changed = split.updateRenderCache(
      makeDirtyLines([[1, '  console.log(msg) // edited']]),
      'light'
    );
    legacy.applyDocumentChange(makeTextDocument(EDITED_LINES));
    const legacyDiff = legacy.getDiffCache();

    // Expected result: a full re-parse of the same edited content from scratch.
    const full = parseDiffFromFile(
      { name: 'greet.ts', contents: OLD_CONTENTS },
      {
        name: 'greet.ts',
        contents: [
          'function greet(name) {',
          '  console.log(msg) // edited',
          '  return msg;',
          '}',
          '',
        ].join('\n'),
      }
    );
    optimized.applyDocumentChange(makeTextDocument(EDITED_LINES));
    const optimizedDiff = optimized.getDiffCache();

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

    const rendered = renderer.getRenderDiff();
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

      const diff = renderer.getDiffCache();
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
        { name: 'old.ts', contents: oldContents },
        { name: 'new.ts', contents: newContents }
      );
      await renderer.asyncRender(diff);
      renderer.renderDiff(diff);
      renderer.applyDocumentChange(EMPTY_DOCUMENT);

      const rendered = renderer.getDiffCache();
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
        { name: 'old.ts', contents: oldContents },
        { name: 'new.ts', contents: newContents }
      );
      await renderer.asyncRender(diff);
      renderer.renderDiff(diff);
      renderer.applyDocumentChange(EMPTY_DOCUMENT);
      renderer.applyDocumentChange(makeTextDocumentFromText('\n'));

      const rendered = renderer.getRenderDiff();
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
        { name: 'old.ts', contents: oldContents },
        { name: 'new.ts', contents: newContents }
      );
      await renderer.asyncRender(diff);
      renderer.renderDiff(diff);
      renderer.applyDocumentChange(EMPTY_DOCUMENT);
      renderer.applyDocumentChange(makeTextDocumentFromText('\n\n'));

      const rendered = renderer.getRenderDiff();
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
        { name: 'old.ts', contents: oldContents },
        { name: 'new.ts', contents: newContents }
      );
      await renderer.asyncRender(diff);
      renderer.renderDiff(diff);
      renderer.applyDocumentChange(EMPTY_DOCUMENT);
      renderer.applyDocumentChange(makeTextDocumentFromText('\n'));

      const rendered = renderer.getRenderDiff();
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
        { name: 'blank.ts', contents: '\n' },
        { name: 'blank.ts', contents: 'typed\n' }
      );
      await renderer.asyncRender(diff);
      renderer.renderDiff(diff);

      renderer.applyDocumentChange(EMPTY_DOCUMENT);

      const rendered = renderer.getDiffCache();
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
