import { afterAll, describe, expect, test } from 'bun:test';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  parseDiffFromFile,
} from '../src';
import { TextDocument } from '../src/editor/textDocument';
import type { FileDiffMetadata, HighlightedToken } from '../src/types';
import type { DiffsTextDocument } from '../src/types';
import { finishEditSessionForDiff } from '../src/utils/editSessionHunks';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import {
  collectAllElements,
  hastTextContent,
  projectRenderResult,
} from './testUtils';

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

function pairingProjection(diff: FileDiffMetadata) {
  return diff.hunks.flatMap((hunk) =>
    hunk.hunkContent.flatMap((content) => {
      if (content.type !== 'change') return [];
      return Array.from(
        { length: Math.max(content.deletions, content.additions) },
        (_, offset) => [
          offset < content.deletions
            ? content.deletionLineIndex + offset
            : undefined,
          offset < content.additions
            ? content.additionLineIndex + offset
            : undefined,
        ]
      );
    })
  );
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

  test('line-count edits preserve line breaks from legacy host documents', async () => {
    const renderer = await createPrimedRenderer('split');

    renderer.applyDocumentChange({
      ...makeTextDocument(EDITED_LINES),
      getText: () => {
        throw new Error('getText should not be called for line-count edits');
      },
    });

    const rendered = renderer.diffCache;
    expect(rendered).toBeDefined();
    if (rendered == null) return;

    expect(rendered.additionLines).toEqual([
      'function greet(name) {\n',
      '  console.log(\n',
      'msg);\n',
      '  return msg;\n',
      '}\n',
    ]);
    expect(rendered.additionLines.join('')).toBe(EDITED_LINES.join('\n'));
  });
});

// While an editor session is active, hunk updates preserve the current region
// skeleton: regions never merge/split/drop on their own, a reverted region
// persists as a context-only hunk, and the real recompute runs once on
// genuine session end.
describe('DiffHunksRenderer edit-session hunk updates', () => {
  const SESSION_LINE_COUNT = 30;

  function sessionLines(edits: Record<number, string> = {}): string[] {
    return Array.from(
      { length: SESSION_LINE_COUNT },
      (_, index) => (edits[index + 1] ?? `line ${index + 1}`) + '\n'
    );
  }

  const SESSION_OLD = sessionLines();
  const SESSION_NEW = sessionLines({ 3: 'changed 3', 20: 'changed 20' });

  async function createSessionRenderer(): Promise<{
    renderer: DiffHunksRenderer;
    diff: FileDiffMetadata;
  }> {
    const renderer = new DiffHunksRenderer({
      theme: 'github-light',
      diffStyle: 'split',
    });
    const diff = parseDiffFromFile(
      { name: 'session.ts', contents: SESSION_OLD.join(''), cacheKey: 's:o' },
      { name: 'session.ts', contents: SESSION_NEW.join(''), cacheKey: 's:n' }
    );
    await renderer.asyncRender(diff);
    renderer.renderDiff(diff);
    renderer.beginEditSession();
    return { renderer, diff };
  }

  test('a mid-document insertion realigns cached addition rows', async () => {
    // Cached per-line HAST is looked up by line index. A run of identical
    // blank lines with `last` at the bottom hidden behind collapsed context:
    // inserting a line above shifts every following index, and the collapsed
    // rows only become visible after session exit — if the cache is not
    // realigned they render another line's stale tokens (a duplicated
    // `last` in the playground).
    const oldContents = 'first\n' + '\n'.repeat(9) + 'last\n';
    const newContents = 'changed\n' + '\n'.repeat(9) + 'last\n';
    const renderer = new DiffHunksRenderer({
      theme: 'github-light',
      diffStyle: 'split',
    });
    const diff = parseDiffFromFile(
      { name: 'jump.ts', contents: oldContents, cacheKey: 'jump:old' },
      { name: 'jump.ts', contents: newContents, cacheKey: 'jump:new' }
    );
    await renderer.asyncRender(diff);
    renderer.renderDiff(diff);
    renderer.beginEditSession();

    // The Enter keystroke: one blank line inserted below the changed line.
    const editedLines = newContents.split('\n');
    editedLines.splice(1, 0, '');
    renderer.applyDocumentChange(makeTextDocument(editedLines));

    renderer.endEditSession();
    finishEditSessionForDiff(diff);

    const result = renderer.renderDiff(diff);
    expect(result).toBeDefined();
    if (result == null) return;
    const rows = (projectRenderResult(result).additions ?? []).filter(
      (row) => row.kind === 'line'
    );
    // Every rendered addition row must show its own source line.
    const mismatches = rows.filter(
      (row) =>
        row.lineNumber != null &&
        row.text !== diff.additionLines[row.lineNumber - 1].replace(/\n$/, '')
    );
    expect(mismatches.map((row) => `#${row.lineNumber}: ${row.text}`)).toEqual(
      []
    );
    expect(
      rows.filter((row) => row.text === 'last').map((row) => row.lineNumber)
    ).toEqual([12]);
  });

  test('session exit restores highlighting for realigned rows', async () => {
    // Realignment plain-fills lines inside the changed window (their old
    // slots were legitimately rewritten mid-pass), and hidden rows are never
    // re-tokenized by the editor. Refreshing the highlighted result at
    // exit — as FileDiff.completeEditSession does — must restore full
    // highlighting without ever rendering the interim view unhighlighted.
    const trailing = 'const last = true;';
    const oldContents = 'first\n' + '\n'.repeat(9) + trailing + '\n';
    const newContents = 'changed\n' + '\n'.repeat(9) + trailing + '\n';
    const renderer = new DiffHunksRenderer({
      theme: 'github-light',
      diffStyle: 'split',
    });
    const diff = parseDiffFromFile(
      { name: 'jump.ts', contents: oldContents, cacheKey: 'jump:old' },
      { name: 'jump.ts', contents: newContents, cacheKey: 'jump:new' }
    );
    await renderer.asyncRender(diff);
    renderer.renderDiff(diff);
    renderer.beginEditSession();

    const editedLines = newContents.split('\n');
    // Mirror the dirty-token pass that precedes applyDocumentChange: the
    // tokenizer rewrites the shifted trailing line's slot (old index 10)
    // with its post-edit content, which is what strands the moved line in
    // the realign's plain-filled window.
    renderer.updateRenderCache(makeDirtyLines([[10, '']]), 'light', true);
    editedLines.splice(1, 0, '');
    renderer.applyDocumentChange(makeTextDocument(editedLines));

    renderer.endEditSession();
    finishEditSessionForDiff(diff);
    const refresh = renderer.refreshHighlightedResult();

    // Highlighted rows carry color styles on their token spans; the
    // realign's plain-filled element has none.
    const styledRowTexts = (result: ReturnType<typeof renderer.renderDiff>) =>
      collectAllElements(result?.additionsContentAST ?? [])
        .filter(
          (node) =>
            node.properties?.['data-line'] != null &&
            JSON.stringify(node).includes('color:')
        )
        .map((node) => hastTextContent(node).replace(/\n$/, ''));

    // The exit repaint runs before the fresh highlight lands: it must keep
    // serving the current result (no un-highlighted flash), with only the
    // realigned window plain.
    expect(styledRowTexts(renderer.renderDiff(diff))).toEqual(['changed']);

    await refresh;
    expect(styledRowTexts(renderer.renderDiff(diff))).toEqual([
      'changed',
      trailing,
    ]);
  });

  test('reverting a hunk keeps it as a context-only region', async () => {
    const { renderer, diff } = await createSessionRenderer();
    const boundsBefore = diff.hunks.map((hunk) => ({
      additionLineIndex: hunk.additionLineIndex,
      additionCount: hunk.additionCount,
    }));

    const regionsChanged = renderer.updateRenderCache(
      makeDirtyLines([[2, 'line 3']]),
      'light'
    );

    expect(regionsChanged).toBe(false);
    expect(diff.hunks).toHaveLength(2);
    expect(diff.hunks[0].additionLineIndex).toBe(
      boundsBefore[0].additionLineIndex
    );
    expect(diff.hunks[0].additionCount).toBe(boundsBefore[0].additionCount);
    expect(diff.hunks[0].hunkContent).toHaveLength(1);
    expect(diff.hunks[0].hunkContent[0].type).toBe('context');
    expect(diff.editSessionDirty).toBe(true);
  });

  test('a gap edit synthesizes a region and reports the escalation', async () => {
    const { renderer, diff } = await createSessionRenderer();

    const regionsChanged = renderer.updateRenderCache(
      makeDirtyLines([[11, 'replaced in gap']]),
      'light'
    );

    expect(regionsChanged).toBe(true);
    expect(diff.hunks).toHaveLength(3);
    expect(diff.hunks[1].additionLineIndex).toBe(11);
  });

  test('reports a row-topology change when region bounds stay fixed', async () => {
    const renderer = new DiffHunksRenderer({
      theme: 'github-light',
      diffStyle: 'split',
    });
    const diff = parseDiffFromFile(
      { name: 'topology.ts', contents: 'a\nb\nc\nd\n' },
      { name: 'topology.ts', contents: 'a\na\na\nd\n' }
    );
    await renderer.asyncRender(diff);
    renderer.renderDiff(diff);
    renderer.beginEditSession();
    const boundsBefore = {
      additionLineIndex: diff.hunks[0].additionLineIndex,
      additionCount: diff.hunks[0].additionCount,
      deletionLineIndex: diff.hunks[0].deletionLineIndex,
      deletionCount: diff.hunks[0].deletionCount,
    };
    const splitCountBefore = diff.hunks[0].splitLineCount;

    const regionsChanged = renderer.updateRenderCache(
      makeDirtyLines([[2, 'b']]),
      'light'
    );

    expect(regionsChanged).toBe(true);
    expect(diff.hunks[0]).toMatchObject(boundsBefore);
    expect(diff.hunks[0].splitLineCount).not.toBe(splitCountBefore);
  });

  test('reports a changed split pairing when the row count stays fixed', async () => {
    const renderer = new DiffHunksRenderer({
      theme: 'github-light',
      diffStyle: 'split',
    });
    const diff = parseDiffFromFile(
      { name: 'pairing.ts', contents: '\nb\nb\nc\n' },
      { name: 'pairing.ts', contents: '\n!\nb\nc\n' }
    );
    await renderer.asyncRender(diff);
    renderer.renderDiff(diff);
    renderer.beginEditSession();
    const boundsBefore = {
      additionLineIndex: diff.hunks[0].additionLineIndex,
      additionCount: diff.hunks[0].additionCount,
      deletionLineIndex: diff.hunks[0].deletionLineIndex,
      deletionCount: diff.hunks[0].deletionCount,
    };
    const splitCountBefore = diff.hunks[0].splitLineCount;

    const regionsChanged = renderer.updateRenderCache(
      makeDirtyLines([[0, 'b']]),
      'light'
    );

    expect(regionsChanged).toBe(true);
    expect(diff.hunks[0]).toMatchObject(boundsBefore);
    expect(diff.hunks[0].splitLineCount).toBe(splitCountBefore);
  });

  // A line-count pass tokenizes every shifted line as dirty at post-edit
  // indexes while diff.additionLines still holds pre-edit content. Region work
  // must wait for applyDocumentChange's authoritative document rebuild.
  test('an Enter keystroke does not disturb other regions', async () => {
    const { renderer, diff } = await createSessionRenderer();
    const secondRegionBefore = {
      deletionLineIndex: diff.hunks[1].deletionLineIndex,
      deletionCount: diff.hunks[1].deletionCount,
      additionCount: diff.hunks[1].additionCount,
      hunkContent: structuredClone(diff.hunks[1].hunkContent),
    };

    // Enter in the middle of "changed 3" (line index 2).
    const postEditLines = [
      ...SESSION_NEW.slice(0, 2),
      'chan\n',
      'ged 3\n',
      ...SESSION_NEW.slice(3),
    ];
    // The tokenizer emits every line from the change to the document end as
    // dirty, using post-edit indexes.
    const denseDirty: Array<[number, string]> = [];
    for (let line = 2; line < postEditLines.length; line++) {
      denseDirty.push([line, postEditLines[line].replace('\n', '')]);
    }
    renderer.updateRenderCache(makeDirtyLines(denseDirty), 'light', true);
    renderer.applyDocumentChange(makeTextDocument(postEditLines));

    expect(diff.hunks).toHaveLength(2);
    // The edited region grew by the inserted line...
    expect(diff.hunks[0].additionCount).toBeGreaterThan(0);
    // ...while the other region only shifted, keeping its shape and its
    // old-side anchors.
    expect(diff.hunks[1].deletionLineIndex).toBe(
      secondRegionBefore.deletionLineIndex
    );
    expect(diff.hunks[1].deletionCount).toBe(secondRegionBefore.deletionCount);
    expect(diff.hunks[1].additionCount).toBe(secondRegionBefore.additionCount);
    expect(diff.additionLines.join('')).toBe(postEditLines.join(''));
    const full = parseDiffFromFile(
      { name: 'session.ts', contents: SESSION_OLD.join('') },
      { name: 'session.ts', contents: postEditLines.join('') }
    );
    expect(pairingProjection(diff)).toEqual(pairingProjection(full));
  });

  test('a same-line edit can rebuild after preserving the trailing editor row', async () => {
    const { renderer, diff } = await createSessionRenderer();
    renderer.applyDocumentChange(makeTextDocumentFromText('line 1\n'));
    expect(diff.additionLines).toEqual(['line 1\n', '']);

    expect(() =>
      renderer.updateRenderCache(
        makeDirtyLines([[0, 'line 1 edited']]),
        'light'
      )
    ).not.toThrow();

    expect(diff.additionLines).toEqual(['line 1 edited\n', '']);
    expect(renderer.renderDiff()).toBeDefined();
  });

  test('a blank line pushed above an edited line keeps the pair aligned', async () => {
    const { renderer, diff } = await createSessionRenderer();
    // Edit line 3 into a near-match of its old side ("line 3" -> "line 3x"),
    // then press Enter at its start: a blank line pushes it down one row.
    renderer.updateRenderCache(makeDirtyLines([[2, 'line 3x']]), 'light');
    const postEditLines = [
      ...SESSION_NEW.slice(0, 2),
      '\n',
      'line 3x\n',
      ...SESSION_NEW.slice(3),
    ];
    renderer.applyDocumentChange(makeTextDocument(postEditLines));

    // The edited line stays paired with its old side; the blank line renders
    // as its own insert row above the pair instead of consuming the pairing.
    const blocks = diff.hunks[0].hunkContent.filter(
      (content) => content.type === 'change'
    );
    expect(
      blocks.map(({ deletions, additions }) => [deletions, additions])
    ).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  test('deleting a line keeps later context paired with its old side', async () => {
    const { renderer, diff } = await createSessionRenderer();
    // Delete context line 5 inside the first region. The region re-diff then
    // contains a deletion-only parsed hunk after shared context; its
    // zero-count addition side reports a `N,0`-convention line index, which
    // previously shifted every following block by one row (the deleted row
    // rendered against the wrong old line until session exit).
    const postEditLines = [...SESSION_NEW.slice(0, 4), ...SESSION_NEW.slice(5)];
    renderer.applyDocumentChange(makeTextDocument(postEditLines));

    const rows: string[] = [];
    iterateOverDiff({
      diff,
      diffStyle: 'split',
      expandedHunks: true,
      callback: ({ type, deletionLine, additionLine }) => {
        rows.push(
          `${type}:${deletionLine?.lineNumber ?? '-'}/${additionLine?.lineNumber ?? '-'}`
        );
        return rows.length >= 7;
      },
    });
    expect(rows).toEqual([
      'context:1/1',
      'context:2/2',
      'change:3/3',
      'context:4/4',
      'change:5/-',
      'context:6/5',
      'context:7/6',
    ]);
  });

  test('emptying the document behaves like the non-session shim', async () => {
    const { renderer, diff } = await createSessionRenderer();
    renderer.applyDocumentChange(makeTextDocument(['']));

    expect(diff.additionLines).toEqual(['']);
    const result = renderer.renderDiff();
    expect(result).toBeDefined();
    if (result == null) return;
    expect(renderer.renderFullHTML(result)).toContain('change-addition');
  });

  test('a same-line undo back to empty reapplies the empty-document shim', async () => {
    const { renderer, diff } = await createSessionRenderer();
    renderer.applyDocumentChange(makeTextDocument(['']));
    renderer.updateRenderCache(makeDirtyLines([[0, 'hello']]), 'light');

    const regionsChanged = renderer.updateRenderCache(
      makeDirtyLines([[0, '']]),
      'light'
    );

    expect(regionsChanged).toBe(true);
    expect(diff.additionLines).toEqual(['']);
    const result = renderer.renderDiff();
    expect(result).toBeDefined();
    if (result == null) return;
    expect(renderer.renderFullHTML(result)).toContain('change-addition');
  });

  test('typing into a newline-only document rebuilds from canonical lines', async () => {
    const { renderer, diff } = await createSessionRenderer();
    renderer.applyDocumentChange(makeTextDocumentFromText('\n'));
    expect(diff.additionLines).toEqual(['\n', '']);

    expect(() =>
      renderer.updateRenderCache(makeDirtyLines([[0, 'typed']]), 'light')
    ).not.toThrow();

    expect(diff.additionLines).toEqual(['typed\n', '']);
    expect(renderer.renderDiff()).toBeDefined();
  });

  test('genuine session end recomputes; a zero-edit session does not', async () => {
    const { renderer, diff } = await createSessionRenderer();
    const untouchedHunks = diff.hunks;

    // Zero-edit end leaves patch-derived hunks untouched.
    expect(finishEditSessionForDiff(diff)).toBe(false);
    expect(diff.hunks).toBe(untouchedHunks);

    // Revert the first hunk mid-session, then end: the context-only region
    // collapses away in the recompute.
    renderer.updateRenderCache(makeDirtyLines([[2, 'line 3']]), 'light');
    expect(diff.hunks[0].hunkContent[0].type).toBe('context');
    expect(finishEditSessionForDiff(diff)).toBe(true);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0].hunkContent.some((c) => c.type === 'change')).toBe(
      true
    );
    expect(diff.editSessionDirty).toBeUndefined();
  });

  test('a session-shaped diff renders through a bounded window', async () => {
    const { renderer, diff } = await createSessionRenderer();
    renderer.updateRenderCache(makeDirtyLines([[2, 'line 3']]), 'light');
    expect(diff.hunks[0].hunkContent[0].type).toBe('context');

    const result = renderer.renderDiff(diff, {
      startingLine: 0,
      totalLines: 10,
      bufferBefore: 0,
      bufferAfter: 0,
    });
    expect(result).toBeDefined();
    if (result == null) return;
    expect(result.rowCount).toBeGreaterThan(0);
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
