import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { TextDocument } from '../src/editor/textDocument';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import {
  DiffHunksRenderer,
  type DiffHunksRendererOptions,
} from '../src/renderers/DiffHunksRenderer';
import type { RenderRange } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

beforeAll(async () => {
  await getSharedHighlighter({
    themes: ['github-light'],
    langs: ['text', 'typescript'],
  });
});

afterAll(async () => {
  await disposeHighlighter();
});

function makeLines(count: number, edits: Record<number, string> = {}): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `${edits[index + 1] ?? `const value${index + 1} = ${index + 1};`}\n`
  ).join('');
}

// Twelve lines with line 3 changed: with every line expanded, unified rows
// are lines 1 and 2, the deletion of line 3, its addition, then lines 4 on.
const DIFF = parseDiffFromFile(
  { name: 'a.ts', contents: makeLines(12) },
  { name: 'a.ts', contents: makeLines(12, { 3: 'const changed3 = 3;' }) }
);
const OPTIONS: DiffHunksRendererOptions = {
  theme: 'github-light',
  diffStyle: 'unified',
  expandUnchanged: true,
  tokenizeMaxLineLength: 1000,
};
const ALL: RenderRange = {
  startingLine: 0,
  totalLines: Infinity,
  bufferBefore: 0,
  bufferAfter: 0,
};

function editAt(
  document: TextDocument<'file-diff', undefined>,
  line: number,
  character: number,
  newText: string
) {
  const change = document.applyEdits([
    {
      range: { start: { line, character }, end: { line, character } },
      newText,
    },
  ]);
  if (change == null) throw new Error('the edit changed nothing');
  return change;
}

describe('DiffHunksRenderer layout reuse', () => {
  test('a diff style change reaches the layout before the editor range is read', () => {
    const renderer = new DiffHunksRenderer<undefined>();
    renderer.setOptions(OPTIONS);
    const session = renderer.startEditSession(DIFF);
    // The third unified row is the deletion of line 3: no new-file line.
    const window: RenderRange = {
      startingLine: 2,
      totalLines: 1,
      bufferBefore: 0,
      bufferAfter: 0,
    };
    try {
      expect(renderer.renderDiff(session, window)?.patched).toBeUndefined();
      expect(renderer.editorRenderRange(session, window)).toEqual({
        ...window,
        startingLine: 0,
        totalLines: 0,
      });
      // In split view the same row shows line 3 on both sides.
      renderer.setOptions({ ...OPTIONS, diffStyle: 'split' });
      expect(renderer.editorRenderRange(session, window)).toEqual({
        ...window,
        startingLine: 2,
        totalLines: 1,
      });
    } finally {
      renderer.cleanUp();
    }
  });

  test('a new highlight result bound into the session rows makes the next layout walk', () => {
    const renderer = new DiffHunksRenderer<undefined>();
    renderer.setOptions(OPTIONS);
    const session = renderer.startEditSession(DIFF);
    const document = new TextDocument<'file-diff', undefined>(
      'inmemory://a.ts',
      session.additionLines.join(''),
      'typescript'
    );
    try {
      expect(renderer.renderDiff(session, ALL)?.patched).toBeUndefined();
      renderer.applyChange(editAt(document, 2, 6, 'x'), document);
      // Nothing else changed: the edited line's rows are patched.
      expect(renderer.renderDiff(session, ALL)?.patched).toBeDefined();
      renderer.applyChange(editAt(document, 2, 6, 'y'), document);
      // An option that changes the highlight replaces every row, so the
      // marked lines cannot be patched into the old ones.
      renderer.setOptions({ ...OPTIONS, tokenizeMaxLineLength: 1 });
      const result = renderer.renderDiff(session, ALL);
      expect(result?.allRowsChanged).toBe(true);
      expect(result?.patched).toBeUndefined();
    } finally {
      renderer.cleanUp();
    }
  });
});
