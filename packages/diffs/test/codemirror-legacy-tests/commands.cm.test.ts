import { describe, expect, test } from 'bun:test';

import {
  applyDeleteWordBackwardToSelections,
  applyTextChangeToSelections,
  DirectionForward,
  DirectionNone,
  expandCollapsedSelectionToWord,
  getSelectedLineBlocks,
  resolveIndentEdits,
  shiftSelectionLines,
} from '../../src/editor/selection';
import { TextDocument } from '../../src/editor/textDocument';
import type { EditorSelection, TextEdit } from '../../src/types';

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

function caret(line: number, character: number): EditorSelection {
  const position = { line, character };
  return {
    start: position,
    end: position,
    direction: DirectionNone,
  } satisfies EditorSelection;
}

function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number
): EditorSelection {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    direction: DirectionForward,
  } satisfies EditorSelection;
}

// Mirrors the Editor's line-based indent dispatch (src/editor/editor.ts, case
// 'indentMore'/'indentLess' at ~line 1891): resolveIndentEdits runs once per
// selection and the resulting edits are concatenated into a single applyEdits
// batch, with no dedupe when two selections touch the same line.
function dispatchLineIndent(
  d: TextDocument<unknown>,
  selections: EditorSelection[],
  tabSize: number,
  outdent: boolean
): EditorSelection[] {
  const edits: TextEdit[] = [];
  const nextSelections: EditorSelection[] = [];
  for (const selection of selections) {
    const [selectionEdits, nextSelection] = resolveIndentEdits(
      d,
      selection,
      tabSize,
      outdent
    );
    edits.push(...selectionEdits);
    nextSelections.push(nextSelection);
  }
  d.applyEdits(edits, true, selections);
  return nextSelections;
}

// Mirrors Editor#moveSelectedLines (src/editor/editor.ts ~line 2267):
// getSelectedLineBlocks merges the selections into line blocks, each block is
// rotated with its neighbor line in one edit, and every selection is remapped
// with shiftSelectionLines — the same composition the keyboard command runs,
// minus the DOM. editorApplyEdits.test.ts covers the single-block and
// separate-block cases through the real Editor; the tests here add the
// merged/interleaved and same-line multi-caret behaviors.
function moveLines(
  d: TextDocument<unknown>,
  selections: EditorSelection[],
  direction: -1 | 1
): EditorSelection[] {
  const blocks = getSelectedLineBlocks(selections);
  if (
    blocks.length === 0 ||
    (direction < 0 && blocks[0].startLine === 0) ||
    (direction > 0 && blocks[blocks.length - 1].endLine >= d.lineCount - 1)
  ) {
    return selections;
  }
  const lineCount = d.lineCount;
  const lineRangeEnd = (line: number) =>
    line < lineCount - 1
      ? { line: line + 1, character: 0 }
      : { line, character: d.getLineLength(line) };
  const getLinesText = (lines: number[], appendFinalLineBreak: boolean) => {
    const text = lines.map((line) => d.getLineText(line)).join(d.eol);
    return appendFinalLineBreak ? text + d.eol : text;
  };
  const edits: TextEdit[] = [];
  if (direction < 0) {
    for (const block of blocks) {
      const previousLine = block.startLine - 1;
      const blockLines: number[] = [];
      for (let line = block.startLine; line <= block.endLine; line++) {
        blockLines.push(line);
      }
      edits.push({
        range: {
          start: { line: previousLine, character: 0 },
          end: lineRangeEnd(block.endLine),
        },
        newText: getLinesText(
          [...blockLines, previousLine],
          block.endLine < lineCount - 1
        ),
      });
    }
  } else {
    for (let index = blocks.length - 1; index >= 0; index--) {
      const block = blocks[index];
      const nextLine = block.endLine + 1;
      const blockLines: number[] = [];
      for (let line = block.startLine; line <= block.endLine; line++) {
        blockLines.push(line);
      }
      edits.push({
        range: {
          start: { line: block.startLine, character: 0 },
          end: lineRangeEnd(nextLine),
        },
        newText: getLinesText(
          [nextLine, ...blockLines],
          nextLine < lineCount - 1
        ),
      });
    }
  }
  const lastBlock = blocks[blocks.length - 1];
  const lastLineLengthAfterMove =
    direction > 0 && lastBlock.endLine === lineCount - 2
      ? d.getLineLength(lastBlock.endLine)
      : d.getLineLength(lineCount - 1);
  const nextSelections = selections.map((selection) =>
    shiftSelectionLines(selection, direction, lineCount, (line) =>
      line === lineCount - 1 ? lastLineLengthAfterMove : d.getLineLength(line)
    )
  );
  d.applyEdits(edits, true, selections, nextSelections, true);
  return nextSelections;
}

// Types a lone Enter at the primary selection, the way the Editor feeds a
// newline keystroke through applyTextChangeToSelections (which expands it via
// expandSingleNewlineInsert to carry the current line's indentation).
function pressEnter(d: TextDocument<unknown>, selection: EditorSelection) {
  const start = d.offsetAt(selection.start);
  const end = d.offsetAt(selection.end);
  return applyTextChangeToSelections(d, [selection], {
    start,
    end,
    text: '\n',
  });
}

describe('line-based indent commands with selections sharing a line', () => {
  // KNOWN BUG: the editor's indent dispatch concatenates each selection's
  // resolveIndentEdits output with no shared-line dedupe, so two carets on one
  // line emit two identical zero-length inserts at column 0. Both pass the
  // overlap validation (equal start offsets never compare as overlapping) and
  // the line is indented twice.
  test.failing('two carets on one line indent that line exactly once', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "doesn't double-indent a given line"
    const d = doc('quartz vein');
    const next = dispatchLineIndent(d, [caret(0, 2), caret(0, 6)], 2, false);
    expect(d.getText()).toBe('  quartz vein');
    expect(next).toEqual([caret(0, 4), caret(0, 8)]);
  });

  // KNOWN BUG: same missing dedupe with range selections — the line shared by
  // both ranges receives one indent edit per selection and ends up indented
  // twice while its neighbors indent once.
  test.failing(
    'two ranges sharing a line indent every line exactly once',
    () => {
      // codemirror-legacy: cm-commands/test/test-commands.ts — "doesn't double-indent a given line"
      const d = doc('ada\nberyl\ncobalt');
      dispatchLineIndent(d, [range(0, 1, 1, 2), range(1, 3, 2, 1)], 2, false);
      expect(d.getText()).toBe('  ada\n  beryl\n  cobalt');
    }
  );

  // KNOWN BUG: the outdent variant of the same composition produces two
  // identical single-character delete edits for the shared line; unlike the
  // zero-length inserts these DO fail overlap validation, so the whole command
  // throws 'Overlapping text edits are not supported' and nothing is applied.
  test.failing(
    'two carets on one tab-indented line outdent it exactly once',
    () => {
      // codemirror-legacy: cm-commands/test/test-commands.ts — "doesn't double-indent a given line"
      const d = doc('\tquartz vein');
      const next = dispatchLineIndent(d, [caret(0, 3), caret(0, 7)], 2, true);
      expect(d.getText()).toBe('quartz vein');
      expect(next).toEqual([caret(0, 2), caret(0, 6)]);
    }
  );
});

describe('indentLess on tab and mixed indentation', () => {
  // Pierre-fe has a single tabSize knob that acts as both the tab's visual
  // width and the indent unit, and its outdent removes raw characters (one
  // whole tab, or up to tabSize leading spaces). CodeMirror separates tab size
  // (4) from indent unit (2) and rewrites the leading whitespace by column
  // arithmetic. Under pierre-fe's own model each outdent below removes exactly
  // one visual unit, so this is a coherent policy difference, not corruption —
  // the residual whitespace is just never normalized to spaces.

  test('outdenting a tab-indented line removes the whole tab', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "can split tabs"
    // DIVERGENCE: CodeMirror splits the tab ('\tone' -> '  one' with a 2-space
    // unit under a 4-column tab); pierre-fe deletes the tab character itself,
    // which at tabSize 2 is exactly one indent unit of visual width.
    const d = doc('\tnode');
    const [edits, next] = resolveIndentEdits(d, caret(0, 5), 2, true);
    expect(edits).toEqual([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        newText: '',
      },
    ]);
    d.applyEdits(edits);
    expect(d.getText()).toBe('node');
    expect(next).toEqual(caret(0, 4));
  });

  test('outdenting space-then-tab indentation trims leading spaces only', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "takes tabs into account"
    // DIVERGENCE: CodeMirror normalizes '   \tone' to '  one' (column count
    // minus one unit, re-written as spaces); pierre-fe deletes tabSize leading
    // space characters and leaves the denormalized ' \t' run in place. At
    // tabSize 2 the visual width still drops by exactly one unit (4 -> 2
    // columns), so the indentation is not broken, merely unnormalized.
    const d = doc('   \tnode');
    const [edits, next] = resolveIndentEdits(d, caret(0, 8), 2, true);
    d.applyEdits(edits);
    expect(d.getText()).toBe(' \tnode');
    expect(next).toEqual(caret(0, 6));
  });

  test('outdenting spaces before a tab leaves the tab as the full indent', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "takes tabs into account"
    // DIVERGENCE: CodeMirror rewrites '  \ttwo' to '  two'; pierre-fe removes
    // the two spaces and keeps the tab ('\tpair'), which again renders at one
    // indent unit under its own tabSize-2 metrics.
    const d = doc('  \tpair');
    const [edits, next] = resolveIndentEdits(d, caret(0, 7), 2, true);
    d.applyEdits(edits);
    expect(d.getText()).toBe('\tpair');
    expect(next).toEqual(caret(0, 5));
  });
});

describe('delete word backward at whitespace and newline boundaries', () => {
  test('after a single leading space it deletes only the line-local space', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "stops deleting at a newline"
    // The scan is strictly per-line: even though only one space separates the
    // caret from column 0, the delete stops at the line start instead of
    // crossing the break into the previous line's word.
    const d = doc('apex \n mono');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 1),
    ]);
    expect(d.getText()).toBe('apex \nmono');
    expect(nextSelections).toEqual([caret(1, 0)]);
  });

  test('after a multi-space leading run it deletes the run and stops at column 0', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "stops deleting at a newline"
    const d = doc('gate\n   crux');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 3),
    ]);
    expect(d.getText()).toBe('gate\ncrux');
    expect(nextSelections).toEqual([caret(1, 0)]);
  });

  test('at column 0 it deletes exactly the break and keeps the trailing space above', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "stops deleting after a newline"
    // Joining consumes only the newline: the previous line's trailing space
    // survives byte-for-byte and the caret lands after it.
    const d = doc('apex \nmono');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 0),
    ]);
    expect(d.getText()).toBe('apex mono');
    expect(nextSelections).toEqual([caret(0, 5)]);
  });
});

describe('delete word backward character groups', () => {
  test('a multi-character punctuation run deletes as one group', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "deletes a group of punctuation"
    const d = doc('stop...halt');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 7),
    ]);
    expect(d.getText()).toBe('stophalt');
    expect(nextSelections).toEqual([caret(0, 4)]);
  });

  test('a mixed space-and-tab run deletes as one whitespace group', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "deletes a group of space"
    // ' \t ' is heterogeneous whitespace; the category loop must treat spaces
    // and tabs as the same group and stop at the word character before them.
    const d = doc('left \t right');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 7),
    ]);
    expect(d.getText()).toBe('leftright');
    expect(nextSelections).toEqual([caret(0, 4)]);
  });

  test('digits and underscore are word characters, so an identifier deletes whole', () => {
    // codemirror-legacy: cm-state/test/test-charcategory.ts — "categorises into alphanumeric"
    const d = doc('v = net_port2');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 13),
    ]);
    expect(d.getText()).toBe('v = ');
    expect(nextSelections).toEqual([caret(0, 4)]);
  });

  test("'<' and '/' share the punctuation category and delete as one run", () => {
    // codemirror-legacy: cm-state/test/test-charcategory.ts — "categorises into other"
    const d = doc('tag</');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 5),
    ]);
    expect(d.getText()).toBe('tag');
    expect(nextSelections).toEqual([caret(0, 3)]);
  });

  test('a lone slash between words deletes alone, not with the word before it', () => {
    // codemirror-legacy: cm-state/test/test-charcategory.ts — "categorises into other"
    // Punctuation is its own category: the group ends where the word
    // characters start, so only the '/' goes.
    const d = doc('up/down');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 3),
    ]);
    expect(d.getText()).toBe('updown');
    expect(nextSelections).toEqual([caret(0, 2)]);
  });

  // Intl.Segmenter's isWordLike classification varies across ICU builds
  // (underscore joining and bare-digit word-ness differ between engines and
  // platforms). Gate the segmenter-side pin on the runtime agreeing with the
  // UAX #29 behavior our dev and CI environments ship, so a divergent ICU
  // skips visibly instead of going red.
  const segmenterJoinsIdentifier = [
    ...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(
      'v = net_port2;'
    ),
  ].some((seg) => seg.segment === 'net_port2' && seg.isWordLike === true);

  test.skipIf(!segmenterJoinsIdentifier)(
    'double-click word expansion agrees the identifier is one word',
    () => {
      // codemirror-legacy: cm-state/test/test-charcategory.ts — "categorises into alphanumeric"
      // Pierre-fe encodes word-ness twice: the delete-word regex
      // (\p{Alphabetic}|\p{Number}|_) and Intl.Segmenter's isWordLike in
      // expandCollapsedSelectionToWord. On CJK text those two disagree (pinned
      // as DIVERGENCE in ../monaco-legacy-tests/wordOperations.monaco.test.ts);
      // on ASCII identifiers they agree — UAX #29 joins letters, digits, and
      // underscore (ExtendNumLet) into a single word segment — so this pins the
      // consistent half of the dual definition.
      const d = doc('v = net_port2;');
      const expected: EditorSelection = {
        start: { line: 0, character: 4 },
        end: { line: 0, character: 13 },
        direction: DirectionForward,
      };
      expect(expandCollapsedSelectionToWord(d, caret(0, 4))).toEqual(expected);
      expect(expandCollapsedSelectionToWord(d, caret(0, 9))).toEqual(expected);
      expect(expandCollapsedSelectionToWord(d, caret(0, 13))).toEqual(expected);
    }
  );
});

describe('move line commands with merged and same-line multi-cursor blocks', () => {
  test('interleaved ranges and a caret merge into one block moving up', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "moves blocks made of multiple ranges as one" (moveLineUp)
    // The three selections touch lines 1-2, 3, and 3-4; the merged block is
    // lines 1-4 and must rotate above line 0 as a unit, with every selection
    // shifted up one line at its original columns.
    const d = doc('red\ngreen\nblue\ncyan\npink');
    const next = moveLines(
      d,
      [range(1, 0, 2, 2), caret(3, 2), range(3, 3, 4, 4)],
      -1
    );
    expect(d.getText()).toBe('green\nblue\ncyan\npink\nred');
    expect(next).toEqual([range(0, 0, 1, 2), caret(2, 2), range(2, 3, 3, 4)]);
  });

  test('interleaved ranges and a caret merge into one block moving down', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "moves blocks made of multiple ranges as one" (moveLineDown)
    const d = doc('red\ngreen\nblue\ncyan\npink\ngray');
    const next = moveLines(
      d,
      [range(1, 0, 2, 2), caret(3, 2), range(3, 3, 4, 4)],
      1
    );
    expect(d.getText()).toBe('red\ngray\ngreen\nblue\ncyan\npink');
    expect(next).toEqual([range(2, 0, 3, 2), caret(4, 2), range(4, 3, 5, 4)]);
  });

  test('multiple carets on one line all survive a move down at their columns', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "preserves multiple cursors on a single line" (moveLineDown)
    const d = doc('alpha\nbravo\ncharlie');
    const next = moveLines(d, [caret(1, 1), caret(1, 4)], 1);
    expect(d.getText()).toBe('alpha\ncharlie\nbravo');
    expect(next).toEqual([caret(2, 1), caret(2, 4)]);
  });

  test('multiple carets on one line all survive a move up at their columns', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "preserves multiple cursors on a single line" (moveLineUp)
    const d = doc('alpha\nbravo\n');
    const next = moveLines(d, [caret(1, 1), caret(1, 3), caret(1, 5)], -1);
    expect(d.getText()).toBe('bravo\nalpha\n');
    expect(next).toEqual([caret(0, 1), caret(0, 3), caret(0, 5)]);
  });

  test('a range ending at column 0 does not drag the line below into the move', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "does not include a trailing line after a range" (moveLineUp)
    // The selection ends at (3,0), so line 3 carries no selected content;
    // getSelectedLineBlocks must exclude it and only lines 1-2 move.
    const d = doc('ash\nbay\ncedar\ndune');
    const next = moveLines(d, [range(1, 0, 3, 0)], -1);
    expect(d.getText()).toBe('bay\ncedar\nash\ndune');
    expect(next).toEqual([range(0, 0, 2, 0)]);
  });
});

describe('Enter and indentation carry-over', () => {
  test('Enter copies the current line leading whitespace onto the new line', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "keeps indentation" (insertNewlineKeepIndent)
    const d = doc('  tune');
    const { nextSelections } = pressEnter(d, caret(0, 6));
    expect(d.getText()).toBe('  tune\n  ');
    expect(nextSelections).toEqual([caret(1, 2)]);
  });

  test('Enter on a whitespace-only line duplicates that whitespace', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "clears empty lines before the cursor" (insertNewlineAndIndent)
    // DIVERGENCE: CodeMirror's language-aware insertNewlineAndIndent replaces
    // a whitespace-only line with '\n', clearing the stale indentation.
    // Pierre-fe's Enter is keep-indent semantics (like CodeMirror's own
    // insertNewlineKeepIndent): expandSingleNewlineInsert copies the current
    // line's leading whitespace unconditionally, so '    ' + Enter leaves
    // '    \n    ' — trailing whitespace stays behind and the indent is
    // duplicated. Judged a policy, not a bug: nothing is lost or corrupted,
    // the result is deterministic and undoable, and clearing would require the
    // language-aware indent pass pierre-fe deliberately does not run.
    const d = doc('    ');
    const { nextSelections } = pressEnter(d, caret(0, 4));
    expect(d.getText()).toBe('    \n    ');
    expect(nextSelections).toEqual([caret(1, 4)]);
  });

  test('Enter replacing a multi-line selection indents from the selection-start line', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "deletes the selection" (insertNewlineKeepIndent)
    // The replaced range spans two indented lines; the inserted break must
    // copy the indentation of the line the selection STARTS on, and the caret
    // lands between that indent and the surviving tail text.
    const d = doc('fn a:\n  leftgone\n  deadright');
    const { nextSelections } = pressEnter(d, range(1, 6, 2, 6));
    expect(d.getText()).toBe('fn a:\n  left\n  right');
    expect(nextSelections).toEqual([caret(2, 2)]);
  });

  test('Enter after an unindented line inserts a bare break', () => {
    // codemirror-legacy: cm-commands/test/test-commands.ts — "keeps zero indentation" (insertNewlineKeepIndent)
    const d = doc('onemore');
    const { nextSelections } = pressEnter(d, caret(0, 3));
    expect(d.getText()).toBe('one\nmore');
    expect(nextSelections).toEqual([caret(1, 0)]);
  });
});
