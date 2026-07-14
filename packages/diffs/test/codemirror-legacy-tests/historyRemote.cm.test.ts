// Undo/redo interacting with non-history edits (updateHistory=false), ported
// from CodeMirror's history suite. See README.md in this directory for suite
// conventions.
//
// Root cause shared by every test.failing below: EditStack entries are frozen
// at creation. When an edit is applied with updateHistory=false (the default
// for Editor.applyEdits — collaborative patches, programmatic fixes, etc.),
// nothing remaps the offsets stored in existing undo/redo entries, so a later
// undo()/redo() applies its inverse/forward edits at stale offsets and
// corrupts the buffer. CodeMirror rebases every stored history item (and its
// selections) through each non-history transaction. The failing tests pin
// distinct surfaces of that one missing mechanism: single-entry undo, the
// dead-entry no-op, batch inversion round trips, interior-insert splitting,
// stored-selection remapping, and the redo direction.
import { describe, expect, test } from 'bun:test';

import { DirectionNone } from '../../src/editor/selection';
import { TextDocument } from '../../src/editor/textDocument';
import type { EditorSelection, TextEdit } from '../../src/types';

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

function caret(line: number, character: number) {
  const position = { line, character };
  return {
    start: position,
    end: position,
    direction: DirectionNone,
  } satisfies EditorSelection;
}

// Every fixture in this file is single-line, so a character index on line 0 is
// also the flat document offset — which keeps the translation from
// CodeMirror's offset-based scenarios direct.
function lineEdit(
  startCharacter: number,
  endCharacter: number,
  newText: string
): TextEdit {
  return {
    range: {
      start: { line: 0, character: startCharacter },
      end: { line: 0, character: endCharacter },
    },
    newText,
  };
}

// A history-recorded local edit, like typing or a command. The caret defaults
// to the edit start.
function localEdit(
  d: ReturnType<typeof doc>,
  startCharacter: number,
  endCharacter: number,
  newText: string,
  selectionsBefore?: EditorSelection[]
) {
  d.applyEdits(
    [lineEdit(startCharacter, endCharacter, newText)],
    true,
    selectionsBefore ?? [caret(0, startCharacter)]
  );
}

// A non-history edit: updateHistory=false, exactly what Editor.applyEdits
// defaults to for programmatic/remote changes.
function remoteEdit(
  d: ReturnType<typeof doc>,
  startCharacter: number,
  endCharacter: number,
  newText: string
) {
  d.applyEdits([lineEdit(startCharacter, endCharacter, newText)]);
}

describe('undo/redo across non-history edits (codemirror-legacy)', () => {
  // codemirror-legacy: cm-commands/test/test-history.ts — "allows to undo a change" / "supports non-tracked changes next to tracked changes"
  // Baseline sanity: a non-history edit strictly AFTER the tracked range does
  // not shift its stored offsets, so undo restores exactly the tracked change
  // even today. The failing tests below differ only in putting the remote edit
  // at/before the tracked offsets.
  test('undo works when the non-history edit sits after the tracked range', () => {
    const d = doc('lemon');
    localEdit(d, 0, 0, 'sour '); // tracked: "sour lemon"
    remoteEdit(d, 10, 10, ' tart'); // remote suffix: "sour lemon tart"
    d.undo();
    expect(d.getText()).toBe('lemon tart');
    expect(d.canUndo).toBe(false);
    expect(d.canRedo).toBe(true);
    d.redo();
    expect(d.getText()).toBe('sour lemon tart');
  });

  // codemirror-legacy: cm-commands/test/test-history.ts — "allows changes that aren't part of the history"
  // KNOWN BUG: undo applies the stored inverse edit at its original offsets
  // without remapping through the two non-history inserts, so it deletes the
  // remote prefix plus part of the remote-shifted typed text instead of the
  // typed text itself (actual today: "ilot?").
  test.failing(
    'undo reverts only the tracked change, leaving non-history text intact',
    () => {
      const d = doc('');
      localEdit(d, 0, 0, 'pilot'); // tracked typing
      remoteEdit(d, 0, 0, 'sync'); // remote prefix: "syncpilot"
      remoteEdit(d, 9, 9, '?'); // remote suffix: "syncpilot?"
      expect(d.getText()).toBe('syncpilot?');

      d.undo();
      expect(d.getText()).toBe('sync?');
    }
  );

  // codemirror-legacy: cm-commands/test/test-history.ts — "doesn't get confused by an undo not adding any redo item"
  // KNOWN BUG: when a non-history edit has replaced the entire region a
  // history entry covers, the entry is dead — undo must be a graceful no-op
  // (and must not leave behind a redo item that re-corrupts). Today undo
  // applies the stale inverse range to the replacement text ("core" -> "ce")
  // and redo then splices the old typed text back in ("cGHe").
  test.failing(
    'undo is a graceful no-op when a non-history edit wiped the tracked region',
    () => {
      const d = doc('ok');
      localEdit(d, 1, 1, 'GH'); // tracked: "oGHk"
      remoteEdit(d, 0, 4, 'core'); // remote replaces the whole doc
      expect(d.getText()).toBe('core');

      d.undo();
      expect(d.getText()).toBe('core');

      // Whether the dead entry is dropped or kept, redo must not corrupt.
      if (d.canRedo) {
        d.redo();
      }
      expect(d.getText()).toBe('core');
    }
  );

  // codemirror-legacy: cm-commands/test/test-history.ts — "accurately maps changes through each other"
  // KNOWN BUG: a batch entry stores per-sub-edit inverse offsets chained
  // through the batch's own deltas, but none of them are remapped through the
  // later non-history insert that landed between the sub-edits. Undo then
  // treats the remote text as if it were the tracked replacements (actual
  // today: undo -> "pqrWXYZ", redo -> "UVWXYZWXYZ").
  test.failing(
    'a replacement batch round-trips through undo/redo across a non-history insert',
    () => {
      const d = doc('pqr');
      // One tracked batch of three adjacent replacements.
      d.applyEdits(
        [lineEdit(0, 1, 'UV'), lineEdit(1, 2, 'WX'), lineEdit(2, 3, 'YZ')],
        true,
        [caret(0, 3)]
      );
      expect(d.getText()).toBe('UVWXYZ');

      // Remote insert exactly between the first and second replacements.
      remoteEdit(d, 2, 2, '####');
      expect(d.getText()).toBe('UV####WXYZ');

      // Undo reverts the three replacements around the remote text.
      d.undo();
      expect(d.getText()).toBe('p####qr');

      // Redo restores the exact pre-undo document.
      d.redo();
      expect(d.getText()).toBe('UV####WXYZ');
    }
  );

  // codemirror-legacy: cm-commands/test/test-history.ts — "preserves text inserted inside a change"
  // KNOWN BUG: undoing a tracked insertion must split its deletion around
  // non-history text that was inserted INSIDE the inserted range, deleting
  // only the tracked characters. Today the whole stale range [0,4) is deleted
  // from "WXjYZ", which erases the remote "j" and strands a tracked "Z"
  // (actual today: "Z").
  test.failing(
    'non-history text inserted inside a tracked insertion survives undo',
    () => {
      const d = doc('');
      localEdit(d, 0, 0, 'WXYZ'); // tracked insertion
      remoteEdit(d, 2, 2, 'j'); // remote insert in the middle of it
      expect(d.getText()).toBe('WXjYZ');

      d.undo();
      expect(d.getText()).toBe('j');
    }
  );

  // codemirror-legacy: cm-commands/test/test-history.ts — "properly maps selections through non-history changes" / "rebases selection on undo"
  // KNOWN BUG: the selections stored in a history entry must be remapped
  // through non-history edits before being restored. Geometry here is chosen
  // so the BUFFER restore is exact (the tracked delete sits at offset 0,
  // unshifted by the later remote insert) and only the selection contract is
  // under test: the caret that sat past the remote insert's position must
  // shift by its length, the one before it must not. Today the entry's
  // selectionsBefore come back verbatim (6 and 11 instead of 6 and 13).
  test.failing(
    'history-entry selections are remapped through later non-history edits before restore',
    () => {
      const d = doc('hello world');
      // Tracked delete of the leading word, with two carets recorded.
      d.applyEdits([lineEdit(0, 5, '')], true, [caret(0, 6), caret(0, 11)]);
      expect(d.getText()).toBe(' world');

      // Remote insert; in the original coordinates this lands at offset 9,
      // between the two stored carets.
      remoteEdit(d, 4, 4, 'XY');
      expect(d.getText()).toBe(' worXYld');

      const result = d.undo();
      expect(d.getText()).toBe('hello worXYld');
      const selections = result?.[1];
      expect(selections?.map((s) => s.start.character)).toEqual([6, 13]);
    }
  );

  // codemirror-legacy: cm-commands/test/test-history.ts — "can group events around a non-history transaction"
  // Two keystrokes separated by an interleaved non-history insert still
  // coalesce into one undo group, and the group inverts around the remote
  // character: one undo leaves exactly the remote text. Note this currently
  // works because the coalescing adjacency check (next insert starts at the
  // previous entry's inverse end) happens to line up in this geometry, not
  // because entries are remapped through remote edits.
  test('adjacent typing coalesces into one undo group across a non-history edit', () => {
    const d = doc('');
    localEdit(d, 0, 0, 'a'); // tracked keystroke: "a"
    remoteEdit(d, 1, 1, 'b'); // remote: "ab"
    localEdit(d, 1, 1, 'c'); // tracked keystroke right after the "a": "acb"
    expect(d.getText()).toBe('acb');

    // Both keystrokes revert in a single undo step, keeping the remote "b".
    d.undo();
    expect(d.getText()).toBe('b');
    expect(d.canUndo).toBe(false);

    // Redo direction: the coalesced group replays around the remote text.
    d.redo();
    expect(d.getText()).toBe('acb');
  });

  // codemirror-legacy: cm-commands/test/test-history.ts — "supports querying for the undo and redo depth"
  // Non-history edits must neither consume undo entries nor clear the redo
  // stack (clearRedo only fires when a new history entry is pushed). Geometry
  // keeps every remote edit after the tracked offsets so the surviving
  // entries also APPLY correctly today; the mapped-offset failure is split
  // into the next test.
  test('a non-history edit neither consumes undo entries nor clears the redo stack', () => {
    const d = doc('alpha');
    localEdit(d, 5, 5, '!'); // tracked: "alpha!"
    expect(d.canUndo).toBe(true);
    expect(d.canRedo).toBe(false);

    remoteEdit(d, 6, 6, ' beta'); // "alpha! beta"
    expect(d.canUndo).toBe(true);
    expect(d.canRedo).toBe(false);

    d.undo();
    expect(d.getText()).toBe('alpha beta');
    expect(d.canUndo).toBe(false);
    expect(d.canRedo).toBe(true);

    // A non-history edit while a redo entry is pending keeps it alive.
    remoteEdit(d, 10, 10, '?'); // "alpha beta?"
    expect(d.canRedo).toBe(true);

    d.redo();
    expect(d.getText()).toBe('alpha! beta?');
    expect(d.canUndo).toBe(true);
    expect(d.canRedo).toBe(false);
  });

  // codemirror-legacy: cm-commands/test/test-history.ts — "supports querying for the undo and redo depth"
  // KNOWN BUG: the redo entry correctly survives a non-history edit (previous
  // test), but its forward edits are never remapped through it, so redo
  // re-inserts at the stale offset (actual today: ">> n!ote" — the "!" lands
  // mid-word instead of at the end it was typed at).
  test.failing(
    'a surviving redo entry applies at offsets mapped through the non-history edit',
    () => {
      const d = doc('note');
      localEdit(d, 4, 4, '!'); // tracked: "note!"
      d.undo();
      expect(d.getText()).toBe('note');
      expect(d.canRedo).toBe(true);

      remoteEdit(d, 0, 0, '>> '); // remote prefix while redo is pending
      expect(d.getText()).toBe('>> note');
      expect(d.canRedo).toBe(true);

      d.redo();
      expect(d.getText()).toBe('>> note!');
    }
  );
});
