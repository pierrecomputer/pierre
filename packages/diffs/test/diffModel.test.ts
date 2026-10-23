import { afterAll, describe, expect, test } from 'bun:test';

import { getChangedDocumentLines } from '../src/editor/getChangedDocumentLines';
import {
  TextDocument,
  type TextDocumentChange,
} from '../src/editor/textDocument';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { DiffModel } from '../src/model/DiffModel';
import { LineMap } from '../src/model/LineMap';
import type { DiffModelChange } from '../src/model/types';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import type { FileDiffMetadata, HighlightedToken } from '../src/types';
import { finishEditSessionForDiff } from '../src/utils/editSessionHunks';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

afterAll(async () => {
  await disposeHighlighter();
});

type Document = TextDocument<'file-diff', undefined>;

function makeLines(
  count: number,
  edits: Record<number, string> = {}
): string[] {
  return Array.from(
    { length: count },
    (_, index) => (edits[index + 1] ?? `line ${index + 1}`) + '\n'
  );
}

const OLD_LINES = makeLines(30);
const NEW_LINES = makeLines(30, { 3: 'changed 3', 20: 'changed 20' });

function makeDiff(
  newLines: string[] = NEW_LINES,
  oldLines: string[] = OLD_LINES
): FileDiffMetadata {
  return parseDiffFromFile(
    { name: 'a.ts', contents: oldLines.join('') },
    { name: 'a.ts', contents: newLines.join('') }
  );
}

function makeDocument(diff: FileDiffMetadata): Document {
  return new TextDocument<'file-diff', undefined>(
    'inmemory://diff-model',
    diff.additionLines.join(''),
    'typescript'
  );
}

function edit(
  document: Document,
  line: number,
  start: number,
  end: number,
  newText: string
): TextDocumentChange {
  const change = document.applyEdits([
    {
      range: {
        start: { line, character: start },
        end: { line, character: end },
      },
      newText,
    },
  ]);
  if (change == null) throw new Error('edit applied nothing');
  return change;
}

// Lists how lines pair up, as "deletion index:addition index" per change row.
function pairing(diff: FileDiffMetadata): string[] {
  return diff.hunks.flatMap((hunk) =>
    hunk.hunkContent.flatMap((content) => {
      if (content.type !== 'change') return [];
      return Array.from(
        { length: Math.max(content.deletions, content.additions) },
        (_, offset) =>
          `${offset < content.deletions ? content.deletionLineIndex + offset : '-'}:${
            offset < content.additions
              ? content.additionLineIndex + offset
              : '-'
          }`
      );
    })
  );
}

describe('LineMap', () => {
  test('starts as the identity', () => {
    const map = new LineMap(3);
    expect([0, 1, 2].map((line) => map.idAt(line))).toEqual([0, 1, 2]);
    expect([0, 1, 2].map((line) => map.originalIndexAt(line))).toEqual([
      0, 1, 2,
    ]);
    expect(() => map.idAt(3)).toThrow();
  });

  test('typing keeps every id and forgets the edited line’s origin', () => {
    const document = makeDocument(makeDiff());
    const map = new LineMap(document.lineCount);
    map.applyChange(edit(document, 2, 0, 0, 'x'));
    expect(map.idAt(2)).toBe(2);
    expect(map.originalIndexAt(2)).toBe(-1);
    expect(map.originalIndexAt(3)).toBe(3);
    expect(map.lineCount).toBe(document.lineCount);
  });

  test('Enter gives the new line a fresh id and shifts the rest', () => {
    const document = makeDocument(makeDiff());
    const map = new LineMap(document.lineCount);
    const idOfLine3 = map.idAt(3);
    map.applyChange(edit(document, 2, 4, 4, '\n'));
    expect(map.idAt(2)).toBe(2);
    expect(map.originalIndexAt(2)).toBe(-1);
    expect(map.idAt(3)).toBe(31);
    expect(map.originalIndexAt(3)).toBe(-1);
    expect(map.idAt(4)).toBe(idOfLine3);
    expect(map.originalIndexAt(4)).toBe(3);
    expect(map.lineCount).toBe(document.lineCount);
  });

  test('joining lines drops the removed id and keeps the ones below', () => {
    const document = makeDocument(makeDiff());
    const map = new LineMap(document.lineCount);
    const idOfLine6 = map.idAt(6);
    // Delete the line break at the end of line 5, joining lines 5 and 6.
    map.applyChange(
      document.applyEdits([
        {
          range: {
            start: { line: 4, character: 'line 5'.length },
            end: { line: 5, character: 0 },
          },
          newText: '',
        },
      ])!
    );
    expect(map.idAt(4)).toBe(4);
    expect(map.originalIndexAt(4)).toBe(-1);
    expect(map.idAt(5)).toBe(idOfLine6);
    expect(map.originalIndexAt(5)).toBe(6);
    expect(map.lineCount).toBe(document.lineCount);
  });

  test('a paste keeps the first replaced line’s id and adds the rest', () => {
    const document = makeDocument(makeDiff());
    const map = new LineMap(document.lineCount);
    const idOfLine1 = map.idAt(1);
    map.applyChange(edit(document, 0, 0, 6, 'a\nb\nc'));
    expect(map.idAt(0)).toBe(0);
    expect(map.idAt(1)).toBe(31);
    expect(map.idAt(2)).toBe(32);
    expect(map.idAt(3)).toBe(idOfLine1);
    expect([0, 1, 2].map((line) => map.originalIndexAt(line))).toEqual([
      -1, -1, -1,
    ]);
    expect(map.originalIndexAt(3)).toBe(1);
  });

  test('a batch applies its edits from the last line up', () => {
    const document = makeDocument(makeDiff());
    const map = new LineMap(document.lineCount);
    const idOfLine10 = map.idAt(10);
    const idOfLine20 = map.idAt(20);
    const change = document.applyEdits([
      {
        range: {
          start: { line: 5, character: 0 },
          end: { line: 5, character: 0 },
        },
        newText: 'inserted\n',
      },
      {
        range: {
          start: { line: 15, character: 0 },
          end: { line: 16, character: 0 },
        },
        newText: '',
      },
    ])!;
    map.applyChange(change);
    expect(change.lineDelta).toBe(0);
    expect(map.idAt(5)).toBe(5);
    expect(map.originalIndexAt(5)).toBe(-1);
    expect(map.idAt(11)).toBe(idOfLine10);
    expect(map.originalIndexAt(11)).toBe(10);
    expect(map.idAt(20)).toBe(idOfLine20);
    expect(map.originalIndexAt(20)).toBe(20);
    expect(map.lineCount).toBe(document.lineCount);
  });

  test('an inserted carriage return joining a line feed adds no line', () => {
    const document = new TextDocument<'file-diff', undefined>(
      'inmemory://crlf',
      'a\nb',
      'typescript'
    );
    const map = new LineMap(document.lineCount);
    map.applyChange(edit(document, 0, 1, 1, '\r'));
    expect(document.getText()).toBe('a\r\nb');
    expect(document.lineCount).toBe(2);
    expect(map.lineCount).toBe(2);
    expect([0, 1].map((line) => map.idAt(line))).toEqual([0, 1]);
    expect(map.originalIndexAt(0)).toBe(-1);
    expect(map.originalIndexAt(1)).toBe(1);
  });

  test('a batch whose breaks join neighbors falls back to one span', () => {
    const document = new TextDocument<'file-diff', undefined>(
      'inmemory://crlf-batch',
      'a\nb\nc\nd',
      'typescript'
    );
    const map = new LineMap(document.lineCount);
    const change = document.applyEdits([
      {
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
        },
        newText: '\r',
      },
      {
        range: {
          start: { line: 2, character: 1 },
          end: { line: 2, character: 1 },
        },
        newText: '\r',
      },
    ])!;
    expect(document.lineCount).toBe(4);
    map.applyChange(change);
    expect(map.lineCount).toBe(4);
    expect(map.idAt(3)).toBe(3);
    expect(map.originalIndexAt(3)).toBe(3);
  });

  test('undo restores the line count with fresh ids for restored lines', () => {
    const document = makeDocument(makeDiff());
    const map = new LineMap(document.lineCount);
    map.applyChange(edit(document, 2, 4, 4, '\n'));
    const [undoChange] = document.undo()!;
    map.applyChange(undoChange);
    expect(map.lineCount).toBe(document.lineCount);
    expect(map.idAt(2)).toBe(2);
    expect(map.originalIndexAt(2)).toBe(-1);
    expect(map.idAt(3)).toBe(3);
  });
});

describe('DiffModel pairs', () => {
  test('pairs changed lines by position in their block', () => {
    const model = DiffModel.fromDiff(makeDiff());
    expect(model.live).toBe(false);
    expect(model.pairFor('additions', 2)).toBe(2);
    expect(model.pairFor('deletions', 2)).toBe(2);
    expect(model.pairFor('additions', 19)).toBe(19);
    expect(model.pairFor('additions', 1)).toBeUndefined();
    expect(model.blockAt('additions', 1)?.type).toBe('context');
    expect(model.lineId(7)).toBe(7);
    expect(model.originalLineIndex(7)).toBe(7);
  });

  test('leaves unpaired lines and lines between hunks alone', () => {
    // Lines 3 and 4 replace two old lines; line 31 is a pure insertion.
    const model = DiffModel.fromDiff(
      makeDiff(makeLines(31, { 3: 'changed 3', 4: 'new 4' }))
    );
    expect(model.pairFor('additions', 2)).toBe(2);
    expect(model.pairFor('additions', 3)).toBe(3);
    expect(model.pairFor('deletions', 3)).toBe(3);
    expect(model.blockAt('additions', 30)?.type).toBe('change');
    expect(model.pairFor('additions', 30)).toBeUndefined();
    expect(model.blockAt('additions', 15)).toBeUndefined();
    expect(model.pairFor('additions', 15)).toBeUndefined();
  });

  test('never pairs the empty line after a final line break', () => {
    // The last block has two old lines and one new line. The editor's empty
    // line after the final line break joins it as a second new line.
    const diff = makeDiff(
      makeLines(30, { 30: 'changed 30' }),
      makeLines(31, { 30: 'old 30', 31: 'old 31' })
    );
    const lastBlock = diff.hunks.at(-1)!.hunkContent.at(-1)!;
    expect(lastBlock).toMatchObject({
      type: 'change',
      deletions: 2,
      additions: 1,
    });
    diff.additionLines = [...diff.additionLines, ''];
    if (lastBlock.type === 'change') lastBlock.additions += 1;
    const model = DiffModel.fromDiff(diff);
    expect(model.pairFor('additions', 29)).toBe(29);
    expect(model.pairFor('additions', 30)).toBeUndefined();
    expect(model.pairFor('deletions', 29)).toBe(29);
    expect(model.pairFor('deletions', 30)).toBeUndefined();
  });
});

// Drives the current renderer the way the editor does, so the model's hunks
// can be compared with what the old path produces for the same edits.
async function createOldSession(diff: FileDiffMetadata): Promise<{
  renderer: DiffHunksRenderer;
  apply(document: Document, change: TextDocumentChange): string;
}> {
  const renderer = new DiffHunksRenderer({
    theme: 'github-light',
    diffStyle: 'split',
  });
  await renderer.asyncRender(diff);
  renderer.renderDiff(diff);
  renderer.beginEditSession(diff);
  renderer.renderDiff(diff);
  return {
    renderer,
    apply(document, change) {
      const dirty = new Map<number, HighlightedToken[]>();
      const last = Math.min(change.endLine, document.lineCount - 1);
      for (let line = change.startLine; line <= last; line++) {
        dirty.set(line, [[0, '', document.getLineText(line)]]);
      }
      const lineCountChanged = change.lineDelta !== 0;
      const layout = renderer.updateRenderCache(
        dirty,
        'dark',
        lineCountChanged,
        lineCountChanged
          ? undefined
          : getChangedDocumentLines(document, change),
        document.lineCount
      );
      if (lineCountChanged) {
        renderer.applyDocumentChange(document);
        return 'rows';
      }
      return layout;
    },
  };
}

// The old renderer's answer for a split view, derived from the model's
// result. The old DOM walk could not retype the "no newline at end of file"
// marker rows, so it answered 'rows' for any block change in such a diff;
// the keyed reconciler has no such limit, so the model does not carry it.
function splitLayout(change: DiffModelChange, diff: FileDiffMetadata): string {
  if (change.lineDelta !== 0 || change.regionsChanged) return 'rows';
  if (!change.blocksChanged) return 'none';
  const lastHunk = diff.hunks.at(-1);
  if (
    lastHunk?.noEOFCRAdditions === true ||
    lastHunk?.noEOFCRDeletions === true
  ) {
    return 'rows';
  }
  return change.splitRowsChanged ? 'rows' : 'lineTypes';
}

type Step = (document: Document) => TextDocumentChange;

interface Script {
  name: string;
  // Applied one at a time, so each implementation sees the document as it
  // was right after that step.
  steps: Step[];
}

function wholeRange(startLine: number, endLine: number, newText: string): Step {
  return (document) =>
    document.applyEdits([
      {
        range: {
          start: { line: startLine, character: 0 },
          end: { line: endLine, character: 0 },
        },
        newText,
      },
    ])!;
}

const SCRIPTS: Script[] = [
  {
    name: 'typing inside a changed line',
    steps: [(document) => edit(document, 2, 9, 9, 'x')],
  },
  {
    name: 'a context line becoming a change',
    steps: [(document) => edit(document, 10, 0, 0, '>> ')],
  },
  {
    name: 'a change reverting to context',
    steps: [(document) => edit(document, 2, 0, 9, 'line 3')],
  },
  {
    name: 'typing in a context line far from any hunk, then undoing it',
    steps: [
      (document) => edit(document, 11, 0, 0, 'q'),
      (document) => document.undo()![0],
    ],
  },
  {
    name: 'Enter inside a changed line',
    steps: [(document) => edit(document, 2, 4, 4, '\n')],
  },
  {
    name: 'Enter at the end of the document, then typing on the new line',
    steps: [
      (document) => edit(document, 30, 0, 0, '\n'),
      (document) => edit(document, 31, 0, 0, 'tail'),
    ],
  },
  {
    name: 'typing into the empty line after the final line break',
    steps: [(document) => edit(document, 30, 0, 0, 'new last')],
  },
  {
    name: 'deleting a whole context line',
    steps: [wholeRange(10, 11, '')],
  },
  {
    name: 'pasting three lines over one',
    steps: [(document) => edit(document, 19, 0, 10, 'one\ntwo\nthree')],
  },
  {
    name: 'edits in two regions in one batch',
    steps: [
      (document) =>
        document.applyEdits([
          {
            range: {
              start: { line: 2, character: 0 },
              end: { line: 2, character: 0 },
            },
            newText: 'A',
          },
          {
            range: {
              start: { line: 19, character: 0 },
              end: { line: 19, character: 0 },
            },
            newText: 'B',
          },
        ])!,
    ],
  },
  {
    name: 'an insert and a delete that cancel out',
    steps: [
      (document) =>
        document.applyEdits([
          {
            range: {
              start: { line: 5, character: 0 },
              end: { line: 5, character: 0 },
            },
            newText: 'inserted\n',
          },
          {
            range: {
              start: { line: 15, character: 0 },
              end: { line: 16, character: 0 },
            },
            newText: '',
          },
        ])!,
    ],
  },
  {
    name: 'deleting everything, then typing',
    steps: [
      wholeRange(0, 30, ''),
      (document) => edit(document, 0, 0, 0, 'fresh'),
    ],
  },
  {
    name: 'blanking the file into a top-aligned document',
    steps: [wholeRange(0, 30, ' \n \n')],
  },
  {
    name: 'typing, Enter, typing on the new line, then undoing all three',
    steps: [
      (document) => edit(document, 10, 0, 0, 'q'),
      (document) => edit(document, 10, 1, 1, '\n'),
      (document) => edit(document, 11, 0, 0, 'r'),
      (document) => document.undo()![0],
      (document) => document.undo()![0],
      (document) => document.undo()![0],
    ],
  },
];

describe('DiffModel.applyChange matches the current renderer', () => {
  test.each(SCRIPTS)('$name', async ({ steps }) => {
    const input = makeDiff();
    // What FileDiff does before the renderer's first write.
    const oldDiff = { ...input, additionLines: [...input.additionLines] };
    delete oldDiff.cacheKey;
    const oldSession = await createOldSession(oldDiff);
    const model = DiffModel.startSession(input);
    const oldDocument = makeDocument(input);
    const newDocument = makeDocument(input);
    try {
      for (const step of steps) {
        const oldLayout = oldSession.apply(oldDocument, step(oldDocument));
        const modelChange = model.applyChange(step(newDocument), newDocument);
        expect(newDocument.getText()).toBe(oldDocument.getText());
        expect(model.diff.additionLines).toEqual(oldDiff.additionLines);
        expect(pairing(model.diff)).toEqual(pairing(oldDiff));
        expect(model.diff.hunks).toEqual(oldDiff.hunks);
        expect(model.diff.type).toBe(oldDiff.type);
        expect(model.diff.editSessionDirty).toBe(oldDiff.editSessionDirty);
        expect(splitLayout(modelChange, model.diff)).toBe(oldLayout);
      }
      expect(input.additionLines).toEqual(NEW_LINES);
      expect(input.hunks).toEqual(makeDiff().hunks);

      oldSession.renderer.endEditSession();
      finishEditSessionForDiff(oldDiff);
      model.finish(1);
      expect(model.diff.hunks).toEqual(oldDiff.hunks);
      expect(model.diff.editSessionDirty).toBeUndefined();
    } finally {
      oldSession.renderer.cleanUp();
    }
  });

  test('a file without a final newline matches the old answer', async () => {
    const input = parseDiffFromFile(
      { name: 'a.ts', contents: 'a' },
      { name: 'a.ts', contents: 'b' }
    );
    const oldDiff = { ...input, additionLines: [...input.additionLines] };
    delete oldDiff.cacheKey;
    const oldSession = await createOldSession(oldDiff);
    const model = DiffModel.startSession(input);
    const oldDocument = makeDocument(input);
    const newDocument = makeDocument(input);
    try {
      const step: Step = (document) => edit(document, 0, 0, 1, 'a');
      const oldLayout = oldSession.apply(oldDocument, step(oldDocument));
      const modelChange = model.applyChange(step(newDocument), newDocument);
      expect(model.diff.hunks).toEqual(oldDiff.hunks);
      expect(oldLayout).toBe('rows');
      expect(splitLayout(modelChange, model.diff)).toBe(oldLayout);
    } finally {
      oldSession.renderer.cleanUp();
    }
  });

  test('reports the lines each edit changed', () => {
    const model = DiffModel.startSession(makeDiff());
    const document = makeDocument(makeDiff());
    expect(
      model.applyChange(edit(document, 2, 9, 9, 'x'), document).changedLines
    ).toEqual([2]);
    expect(
      model.applyChange(edit(document, 2, 4, 4, '\n'), document).changedLines
    ).toEqual([2, 3]);
    expect(model.lineId(3)).toBe(31);
    expect(model.lineId(4)).toBe(3);
    expect(model.originalLineIndex(4)).toBe(3);
  });
});

describe('DiffModel sessions', () => {
  test('a snapshot resumes a draft against the same old file', () => {
    const input = makeDiff();
    const model = DiffModel.startSession(input);
    const document = makeDocument(input);
    model.applyChange(edit(document, 10, 0, 0, '>> '), document);
    expect(model.hasChanges).toBe(true);
    const snapshot = model.snapshot();
    const resumed = DiffModel.startSession(makeDiff(), {
      document: { name: 'a.ts', contents: document.getText() },
      snapshot,
    });
    expect(resumed.diff.additionLines).toEqual(model.diff.additionLines);
    expect(resumed.diff.hunks).toEqual(model.diff.hunks);
    expect(resumed.hasChanges).toBe(true);
  });

  test('a snapshot cannot resume against a different old file', () => {
    const input = makeDiff();
    const model = DiffModel.startSession(input);
    const other = makeDiff(NEW_LINES, makeLines(30, { 1: 'other' }));
    expect(() =>
      DiffModel.startSession(other, {
        document: { name: 'a.ts', contents: input.additionLines.join('') },
        snapshot: model.snapshot(),
      })
    ).toThrow('different old file');
  });

  test('retained edits need their session state', () => {
    expect(() =>
      DiffModel.startSession(makeDiff(), {
        document: { name: 'a.ts', contents: 'edited\n' },
      })
    ).toThrow('missing their diff session state');
  });

  test('an empty new file keeps one editable line', () => {
    const input = makeDiff([], OLD_LINES);
    const model = DiffModel.startSession(input);
    expect(model.diff.additionLines).toEqual(['']);
    expect(model.diff.hunks.length).toBeGreaterThan(0);
    expect(model.hasChanges).toBe(true);
    expect(input.additionLines).toEqual([]);
  });

  test('expansion survives an edit that keeps the regions', () => {
    const input = makeDiff();
    const model = DiffModel.startSession(input);
    model.expandHunk(1, 'up', 5);
    const document = makeDocument(input);
    model.applyChange(edit(document, 2, 9, 9, 'x'), document);
    expect(model.expandedHunks.get(1)).toEqual({ fromStart: 5, fromEnd: 0 });
  });

  test('a static model refuses changes', () => {
    const model = DiffModel.fromDiff(makeDiff());
    const document = makeDocument(makeDiff());
    expect(() =>
      model.applyChange(edit(document, 2, 9, 9, 'x'), document)
    ).toThrow('not live');
  });
});
