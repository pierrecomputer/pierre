import { afterAll, describe, expect, test } from 'bun:test';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  parseDiffFromFile,
} from '../src';
import type { DiffsTextDocument, HighlightedToken } from '../src/types';

afterAll(async () => {
  await disposeHighlighter();
});

// A diff where the addition and deletion sides have different line counts
// (one line deleted) — the common case. `updateDiffHunks` cannot incrementally
// recompute across a line-count mismatch, so without the skip flag
// `updateRenderCache` falls back to a full `recomputeDiffHunks`.
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
    const cacheDiff = renderer.getRenderDiff();
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
    expect(renderer.getRenderDiff()?.hunks).not.toBe(hunksAfterUpdate);
  });

  test('skip flag avoids the recompute in updateRenderCache', async () => {
    const renderer = await createPrimedRenderer();
    const cacheDiff = renderer.getRenderDiff();
    expect(cacheDiff).toBeDefined();
    if (cacheDiff == null) return;

    const hunksBeforeUpdate = cacheDiff.hunks;
    renderer.updateRenderCache(
      makeDirtyLines(DIRTY_EDIT),
      'light',
      /* skipDiffRecompute */ true
    );
    // No recompute: the hunks array reference is untouched.
    expect(cacheDiff.hunks).toBe(hunksBeforeUpdate);
  });

  test('skip flag preserves the final diff after applyDocumentChange', async () => {
    const legacy = await createPrimedRenderer();
    legacy.updateRenderCache(
      makeDirtyLines(DIRTY_EDIT),
      'light',
      /* skipDiffRecompute */ false
    );
    legacy.applyDocumentChange(makeTextDocument(EDITED_LINES));
    const legacyDiff = legacy.getRenderDiff();

    const optimized = await createPrimedRenderer();
    optimized.updateRenderCache(
      makeDirtyLines(DIRTY_EDIT),
      'light',
      /* skipDiffRecompute */ true
    );
    optimized.applyDocumentChange(makeTextDocument(EDITED_LINES));
    const optimizedDiff = optimized.getRenderDiff();

    expect(legacyDiff).toBeDefined();
    expect(optimizedDiff).toBeDefined();
    if (legacyDiff == null || optimizedDiff == null) return;

    expect(optimizedDiff.hunks).toEqual(legacyDiff.hunks);
    expect(optimizedDiff.additionLines).toEqual(legacyDiff.additionLines);
    expect(optimizedDiff.deletionLines).toEqual(legacyDiff.deletionLines);
    expect(optimizedDiff.splitLineCount).toBe(legacyDiff.splitLineCount);
    expect(optimizedDiff.unifiedLineCount).toBe(legacyDiff.unifiedLineCount);
    expect(optimizedDiff.type).toBe(legacyDiff.type);
  });

  test('skip flag preserves the rendered output after applyDocumentChange', async () => {
    const legacy = await createPrimedRenderer();
    legacy.updateRenderCache(makeDirtyLines(DIRTY_EDIT), 'light', false);
    legacy.applyDocumentChange(makeTextDocument(EDITED_LINES));
    const legacyResult = legacy.renderDiff();

    const optimized = await createPrimedRenderer();
    optimized.updateRenderCache(makeDirtyLines(DIRTY_EDIT), 'light', true);
    optimized.applyDocumentChange(makeTextDocument(EDITED_LINES));
    const optimizedResult = optimized.renderDiff();

    expect(legacyResult).toBeDefined();
    expect(optimizedResult).toBeDefined();
    if (legacyResult == null || optimizedResult == null) return;

    expect(optimized.renderFullHTML(optimizedResult)).toBe(
      legacy.renderFullHTML(legacyResult)
    );
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

      const diff = renderer.getRenderDiff();
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

      const rendered = renderer.getRenderDiff();
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
