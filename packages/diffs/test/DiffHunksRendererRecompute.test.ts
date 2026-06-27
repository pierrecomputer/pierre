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

describe('DiffHunksRenderer content-edit recompute split', () => {
  test('updateRenderCache returns changed addition lines and does not recompute', async () => {
    const renderer = await createPrimedRenderer();
    const cacheDiff = renderer.getRenderDiff();
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
    split.recomputeContentHunks(changed);
    const incremental = split.getRenderDiff();

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

    expect(incremental).toBeDefined();
    if (incremental == null) return;
    expect(incremental.hunks).toEqual(full.hunks);
    expect(incremental.splitLineCount).toBe(full.splitLineCount);
    expect(incremental.unifiedLineCount).toBe(full.unifiedLineCount);
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
