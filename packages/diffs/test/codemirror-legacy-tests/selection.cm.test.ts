import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../../src/components/File';
import { DEFAULT_THEMES } from '../../src/constants';
import { Editor } from '../../src/editor/editor';
import {
  applyTextReplaceToSelections,
  DirectionBackward,
  DirectionForward,
  DirectionNone,
  mergeOverlappingSelections,
} from '../../src/editor/selection';
import { TextDocument } from '../../src/editor/textDocument';
import { disposeHighlighter } from '../../src/highlighter/shared_highlighter';
import type {
  EditorSelection,
  FileContents,
  SelectionDirection,
} from '../../src/types';
import { installDom, wait } from '../domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

function caret(line: number, character: number): EditorSelection {
  const position = { line, character };
  return { start: position, end: position, direction: DirectionNone };
}

// CodeMirror addresses selections by flat anchor/head offsets. All the pure
// merge scenarios below live on line 0, so `character` doubles as the flat
// offset from the CodeMirror originals.
function sel(
  startCharacter: number,
  endCharacter: number,
  direction: SelectionDirection = DirectionForward
): EditorSelection {
  return {
    start: { line: 0, character: startCharacter },
    end: { line: 0, character: endCharacter },
    direction,
  };
}

describe('caret at the shared boundary of touching ranges (codemirror-legacy)', () => {
  // codemirror-legacy: cm-state/test/test-selection.ts — "merges adjacent point ranges when normalizing"
  test('boundary caret is absorbed into the left neighbor and the ranges stay separate', () => {
    // Two non-empty ranges touch at character 10 with a caret sitting exactly
    // on the seam. Non-empty touching ranges never merge with each other, but
    // the caret intersects both; it must be absorbed exactly once. Both
    // pierre-fe and CodeMirror fold it into the LEFT range (8-10): the caret's
    // character equals the left range's end, and the single merge pass reaches
    // it while the left range is still current.
    const merged = mergeOverlappingSelections([
      sel(8, 10),
      caret(0, 10),
      sel(10, 12),
    ]);
    expect(merged).toEqual([
      // The caret was the latest of the merged pair, so direction is
      // re-derived from its side: the caret sits at the merged range's end,
      // making the result forward.
      sel(8, 10, DirectionForward),
      sel(10, 12, DirectionForward),
    ]);
  });

  // codemirror-legacy: cm-state/test/test-selection.ts — "merges adjacent point ranges when normalizing"
  test('absorbing the boundary caret overrides a backward left neighbor to forward', () => {
    // Same geometry with a backward 8-10 range. The caret is the later entry
    // in the merged pair, so its (recomputed) direction wins: the caret lands
    // at the merged end => forward. CodeMirror derives the same answer — the
    // later range's anchor/head order decides, and a cursor is never backward.
    const merged = mergeOverlappingSelections([
      sel(8, 10, DirectionBackward),
      caret(0, 10),
      sel(10, 12),
    ]);
    expect(merged).toEqual([
      sel(8, 10, DirectionForward),
      sel(10, 12, DirectionForward),
    ]);
  });
});

describe('normalization stress from scrambled input (codemirror-legacy)', () => {
  // codemirror-legacy: cm-state/test/test-selection.ts — "merges and sorts ranges when normalizing"
  test('one range transitively swallows contained ranges while touching ranges stay separate', () => {
    // Eight shuffled ranges. 0-6 contains 3-4 and 4-5 outright; 6-7 touches
    // 0-6's end but is non-empty, so it stays separate (as do 7-8 and 13-14
    // against their neighbors). 9-13 contains 10-12. Five ranges survive:
    // {0-6, 6-7, 7-8, 9-13, 13-14} — the same set CodeMirror normalizes to.
    const merged = mergeOverlappingSelections([
      sel(10, 12), // index 0: swallowed by 9-13
      sel(6, 7), //   index 1
      sel(4, 5), //   index 2: swallowed by 0-6
      sel(3, 4), //   index 3: swallowed by 0-6
      sel(0, 6), //   index 4
      sel(7, 8), //   index 5
      sel(9, 13), //  index 6
      sel(13, 14), // index 7
    ]);
    // DIVERGENCE: CodeMirror returns ranges re-sorted by position
    // (0/6,6/7,7/8,9/13,13/14) and tracks the primary via a separate
    // mainIndex. pierre-fe's primary selection is "last element of the
    // array", so mergeOverlappingSelections restores the caller's original
    // index order instead, with each merged group keeping the LATEST
    // participating index: the 0-6 group keeps index 4, the 9-13 group keeps
    // index 6. Hence 6-7 (index 1) precedes 0-6 (index 4) in the output.
    expect(merged).toEqual([
      sel(6, 7),
      sel(0, 6),
      sel(7, 8),
      sel(9, 13),
      sel(13, 14),
    ]);
  });
});

describe('per-range replacements of different lengths on one line (codemirror-legacy)', () => {
  // codemirror-legacy: cm-state/test/test-state.ts — "does the right thing when there are multiple selections"
  test('every later selection shifts by the cumulative length delta of preceding replacements', () => {
    // Four single-character selections on one line, each replaced by a
    // different-length string. Each replacement lands at its original offset
    // plus the summed growth of everything before it on the same line.
    const d = doc('a b c d');
    const selections = [sel(0, 1), sel(2, 3), sel(4, 5), sel(6, 7)];
    const texts = ['x', 'yy', 'zzz', 'wwww'];

    const { nextSelections } = applyTextReplaceToSelections(
      d,
      selections,
      texts
    );

    expect(d.getText()).toBe('x yy zzz wwww');

    // Cumulative deltas per slot: +0, +0, +1, +3. CodeMirror's changeByRange
    // reports the remapped spans 0-1 / 2-4 / 5-8 / 9-13; pierre-fe collapses
    // each result to a caret after the inserted text, i.e. at those spans'
    // ends.
    expect(nextSelections).toEqual([
      caret(0, 1),
      caret(0, 4),
      caret(0, 8),
      caret(0, 13),
    ]);
    // The caret offsets are exactly originalStart + cumulativeDelta + inserted
    // length.
    let delta = 0;
    for (let index = 0; index < selections.length; index++) {
      const start = selections[index].start.character;
      const inserted = texts[index].length;
      expect(nextSelections[index].end.character).toBe(
        start + delta + inserted
      );
      delta += inserted - 1; // each replacement consumed one character
    }
  });

  // codemirror-legacy: cm-state/test/test-state.ts — "does the right thing when there are multiple selections"
  test('replacement texts stay paired with their selection when input is not in document order', () => {
    // Same replacement set handed over in reverse document order: texts must
    // travel with their selection, and results must come back in the caller's
    // input order (not sorted document order).
    const d = doc('a b c d');
    const { nextSelections } = applyTextReplaceToSelections(
      d,
      [sel(6, 7), sel(4, 5), sel(2, 3), sel(0, 1)],
      ['wwww', 'zzz', 'yy', 'x']
    );

    expect(d.getText()).toBe('x yy zzz wwww');
    expect(nextSelections).toEqual([
      caret(0, 13),
      caret(0, 8),
      caret(0, 4),
      caret(0, 1),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Public Editor.setSelections scenarios: these need the real Editor, mounted
// through the same File-backed harness the editorPublicApi suite uses.
// ---------------------------------------------------------------------------

async function waitForEditableContent(
  container: HTMLElement
): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const content = container.shadowRoot?.querySelector('[data-content]');
    if (
      content instanceof HTMLElement &&
      (content.contentEditable === 'true' ||
        content.getAttribute('contenteditable') === 'true')
    ) {
      return content;
    }
    await wait(0);
  }

  throw new Error('editor content did not become editable');
}

interface EditorFixture {
  cleanup(): void;
  editor: Editor<undefined>;
}

async function createEditorFixture(contents: string): Promise<EditorFixture> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined>();
  const initialFile: FileContents = { name: 'selections.txt', contents };

  file.render({ file: initialFile, fileContainer, forceRender: true });
  editor.edit(file);
  await waitForEditableContent(fileContainer);

  return {
    cleanup() {
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    },
    editor,
  };
}

describe('Editor.setSelections position clamping (codemirror-legacy)', () => {
  // codemirror-legacy: cm-state/test/test-state.ts — "throws when a change's bounds are invalid"
  // (selection analog: CodeMirror's checkSelection throws RangeError
  // "Selection points outside of document" for the same out-of-bounds input on
  // state creation/update.)
  test('positions past a line length or past the last line clamp instead of throwing', async () => {
    // DIVERGENCE: CodeMirror rejects out-of-range selections with a
    // RangeError; pierre-fe's setSelections routes every position through
    // TextDocument.normalizePosition, clamping line to the last line and
    // character to that line's length. Out-of-bounds input is accepted and
    // the caret lands on real content.
    const { cleanup, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      // Character overshoots line 1 ("bravo", length 5): clamps to the line
      // end, keeping the line.
      editor.setSelections([
        {
          start: { line: 1, character: 99 },
          end: { line: 1, character: 99 },
          direction: 'none',
        },
      ]);
      expect(editor.getState().selections).toEqual([caret(1, 5)]);

      // Both line and character overshoot: the primary caret lands exactly at
      // the document end ("charlie" is line 2, length 7).
      editor.setSelections([
        {
          start: { line: 99, character: 99 },
          end: { line: 99, character: 99 },
          direction: 'none',
        },
      ]);
      expect(editor.getState().selections).toEqual([caret(2, 7)]);
    } finally {
      cleanup();
    }
  });

  // codemirror-legacy: cm-state/test/test-state.ts — "throws when a change's bounds are invalid"
  test('a range whose end overshoots the document clamps only the overshooting edge', async () => {
    const { cleanup, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 99, character: 99 },
          direction: 'forward',
        },
      ]);
      // The valid start edge is untouched; the end edge clamps to doc end and
      // the direction survives.
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 2 },
          end: { line: 2, character: 7 },
          direction: DirectionForward,
        },
      ]);
    } finally {
      cleanup();
    }
  });
});

describe('Editor.setSelections with a reversed range (codemirror-legacy)', () => {
  // codemirror-legacy: cm-state/test/test-selection.ts — "stores ranges with a primary range"
  // KNOWN BUG: setSelections normalizes each position independently but never
  // reorders the pair, so a selection whose start sits after its end is stored
  // inverted (start 1:3 / end 0:2), violating the start <= end invariant that
  // downstream code (offset resolution, rendering, merge) assumes. CodeMirror's
  // EditorSelection.range(3, 2) normalizes to from=2/to=3 with the backward
  // flag; the equivalent here is swapping start/end and flipping the direction
  // to backward, since the focus edge the caller supplied now sits first.
  test.failing(
    'a start-after-end selection is stored with ordered edges and backward direction',
    async () => {
      const { cleanup, editor } = await createEditorFixture(
        'alpha\nbravo\ncharlie'
      );
      try {
        editor.setSelections([
          {
            start: { line: 1, character: 3 },
            end: { line: 0, character: 2 },
            direction: 'forward',
          },
        ]);
        expect(editor.getState().selections).toEqual([
          {
            start: { line: 0, character: 2 },
            end: { line: 1, character: 3 },
            direction: DirectionBackward,
          },
        ]);
      } finally {
        cleanup();
      }
    }
  );
});
