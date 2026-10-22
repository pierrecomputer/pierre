import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { toHtml } from 'hast-util-to-html';
import { JSDOM } from 'jsdom';

import { TextDocument } from '../src/editor/textDocument';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import type {
  FileDiffMetadata,
  HighlightedToken,
  LineDiffTypes,
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

beforeAll(async () => {
  await getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
});

afterAll(async () => {
  await disposeHighlighter();
});

const OLD = [
  'const first = alpha(1);',
  'const second = beta;',
  'const third = gamma(3);',
  'export { first, second, third };',
].join('\n');
const NEW = [
  'const first = alpha(2);',
  'const second = beta;',
  'let third = gamma(3, 4);',
  'export { first, second, third };',
].join('\n');

type DiffStyle = 'split' | 'unified';

function createRenderer(
  diffStyle: DiffStyle,
  lineDiffType: LineDiffTypes
): DiffHunksRenderer {
  return new DiffHunksRenderer({
    theme: 'pierre-dark',
    diffStyle,
    lineDiffType,
    expandUnchanged: true,
  });
}

function createDiff(newContents = NEW, oldContents = OLD): FileDiffMetadata {
  return parseDiffFromFile(
    { name: 'example.ts', contents: oldContents },
    { name: 'example.ts', contents: newContents }
  );
}

// Lists every row that has word diff highlights, as
// "<line type>:<line number>:<start>-<end> <highlighted text>|...".
function getHighlights(
  renderer: DiffHunksRenderer,
  diff: FileDiffMetadata
): string[] {
  const result = renderer.renderDiff(diff);
  if (result == null) throw new Error('expected a render result');
  const fragment = JSDOM.fragment(
    toHtml([
      ...(result.unifiedContentAST ?? []),
      ...(result.deletionsContentAST ?? []),
      ...(result.additionsContentAST ?? []),
    ])
  );
  const rows: string[] = [];
  for (const row of fragment.querySelectorAll('[data-line][data-line-type]')) {
    const marks = [...row.querySelectorAll('[data-diff-span]')].map((mark) => {
      const start = getTextOffset(row, mark);
      const text = mark.textContent ?? '';
      return `${start}-${start + text.length} ${text}`;
    });
    if (marks.length > 0) {
      rows.push(
        `${row.getAttribute('data-line-type')}:${row.getAttribute('data-line')}:${marks.join('|')}`
      );
    }
  }
  return rows.sort();
}

// The column where `mark` starts within the text of `row`.
function getTextOffset(row: Element, mark: Element): number {
  const walker = row.ownerDocument.createTreeWalker(row, 4 /* text nodes */);
  let offset = 0;
  for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
    if (mark.contains(node)) return offset;
    offset += node.textContent?.length ?? 0;
  }
  throw new Error('highlight is not inside its row');
}

// The highlights a read-only render shows for the same final text.
function getReadOnlyHighlights(
  diffStyle: DiffStyle,
  lineDiffType: LineDiffTypes,
  newContents: string,
  oldContents = OLD
): string[] {
  const renderer = createRenderer(diffStyle, lineDiffType);
  try {
    return getHighlights(renderer, createDiff(newContents, oldContents));
  } finally {
    renderer.cleanUp();
  }
}

// Replaces one line of the new file the way the editor does, with the line's
// fresh tokens and its text.
function editLine(
  renderer: DiffHunksRenderer,
  diff: FileDiffMetadata,
  line: number,
  text: string
): void {
  const tokens: HighlightedToken[] = [[0, '#abcdef', text]];
  renderer.updateRenderCache(
    new Map([[line, tokens]]),
    'dark',
    false,
    new Map([[line, `${text}\n`]]),
    diff.additionLines.length + 1
  );
}

function withSession(
  diffStyle: DiffStyle,
  lineDiffType: LineDiffTypes,
  run: (renderer: DiffHunksRenderer, diff: FileDiffMetadata) => void
): void {
  const renderer = createRenderer(diffStyle, lineDiffType);
  const diff = createDiff();
  try {
    renderer.beginEditSession(diff);
    getHighlights(renderer, diff);
    run(renderer, diff);
  } finally {
    renderer.cleanUp();
  }
}

function replaceLine(contents: string, line: number, text: string): string {
  const lines = contents.split('\n');
  lines[line] = text;
  return lines.join('\n');
}

describe('word diff highlights during an edit session', () => {
  for (const diffStyle of ['split', 'unified'] as const) {
    describe(diffStyle, () => {
      test('stay on rows the editor re-tokenizes without changing', () => {
        withSession(diffStyle, 'word-alt', (renderer, diff) => {
          const before = getHighlights(renderer, diff);
          expect(before.length).toBeGreaterThan(0);
          // Re-tokenizing, for example after a theme change, rebuilds the
          // rows from tokens that have no highlights.
          for (const [line, text] of NEW.split('\n').entries()) {
            renderer.updateRenderCache(
              new Map([[line, [[0, '#123456', text]]]]),
              'dark'
            );
          }
          expect(getHighlights(renderer, diff)).toEqual(before);
        });
      });

      for (const lineDiffType of [
        'word-alt',
        'word',
        'char',
        'word-line',
      ] as const) {
        // The second text repeats a word, so highlights at the wrong copy
        // of it would show up.
        for (const text of [
          'let third = delta(3, 5);',
          'const third = gamma(gamma);',
        ]) {
          test(`follow an edited changed line on both sides (${lineDiffType}, ${text})`, () => {
            withSession(diffStyle, lineDiffType, (renderer, diff) => {
              editLine(renderer, diff, 2, text);
              expect(getHighlights(renderer, diff)).toEqual(
                getReadOnlyHighlights(
                  diffStyle,
                  lineDiffType,
                  replaceLine(NEW, 2, text)
                )
              );
            });
          });
        }
      }

      test('appear when a context line is edited into a change', () => {
        withSession(diffStyle, 'word-alt', (renderer, diff) => {
          const text = 'const second = epsilon;';
          editLine(renderer, diff, 1, text);
          const highlights = getHighlights(renderer, diff);
          expect(highlights.some((row) => row.includes('epsilon'))).toBe(true);
          expect(highlights).toEqual(
            getReadOnlyHighlights(
              diffStyle,
              'word-alt',
              replaceLine(NEW, 1, text)
            )
          );
        });
      });

      test('go away when a changed line is edited back to the original', () => {
        withSession(diffStyle, 'word-alt', (renderer, diff) => {
          editLine(renderer, diff, 2, 'const third = gamma(3);');
          const highlights = getHighlights(renderer, diff);
          expect(highlights.some((row) => row.includes(':3:'))).toBe(false);
          expect(highlights).toEqual(
            getReadOnlyHighlights(
              diffStyle,
              'word-alt',
              replaceLine(NEW, 2, 'const third = gamma(3);')
            )
          );
        });
      });

      test('follow their lines when an edit adds a line above them', () => {
        withSession(diffStyle, 'word-alt', (renderer, diff) => {
          const lines = NEW.split('\n');
          lines.splice(2, 0, '// added');
          const contents = lines.join('\n');
          renderer.applyDocumentChange(
            new TextDocument<'file-diff', undefined>(
              'inmemory://edit-line-diff-marks',
              contents,
              'typescript'
            )
          );
          expect(getHighlights(renderer, diff)).toEqual(
            getReadOnlyHighlights(diffStyle, 'word-alt', contents)
          );
        });
      });

      test('are not added to the empty row after a line break typed at the end', () => {
        const oldContents = 'const a = 1;\nconst b = 2;\n';
        const renderer = createRenderer(diffStyle, 'word-alt');
        const diff = createDiff('const a = 3;', oldContents);
        try {
          renderer.beginEditSession(diff);
          getHighlights(renderer, diff);
          renderer.applyDocumentChange(
            new TextDocument<'file-diff', undefined>(
              'inmemory://edit-line-diff-marks',
              'const a = 3;\n',
              'typescript'
            )
          );
          expect(getHighlights(renderer, diff)).toEqual(
            getReadOnlyHighlights(
              diffStyle,
              'word-alt',
              'const a = 3;\n',
              oldContents
            )
          );
        } finally {
          renderer.cleanUp();
        }
      });

      test('come back on a re-tokenized row when it returns to its partner', () => {
        const oldContents =
          'const first = 1;\nconst second = 2;\nconst third = 3;\n';
        const newContents =
          'const first = 4;\nconst second = 5;\nconst third = 6;\n';
        const renderer = createRenderer(diffStyle, 'word-alt');
        const diff = createDiff(newContents, oldContents);
        const setDocument = (contents: string) =>
          renderer.applyDocumentChange(
            new TextDocument<'file-diff', undefined>(
              'inmemory://edit-line-diff-marks',
              contents,
              'typescript'
            )
          );
        try {
          renderer.beginEditSession(diff);
          getHighlights(renderer, diff);
          for (const [line, text] of newContents.split('\n').entries()) {
            if (text === '') continue;
            renderer.updateRenderCache(
              new Map([[line, [[0, '#123456', text]]]]),
              'dark'
            );
          }
          getHighlights(renderer, diff);
          // Removing the middle line pairs the third line with another old
          // line; restoring it pairs the third line with its partner again.
          setDocument('const first = 4;\nconst third = 6;\n');
          getHighlights(renderer, diff);
          setDocument(newContents);
          expect(getHighlights(renderer, diff)).toEqual(
            getReadOnlyHighlights(
              diffStyle,
              'word-alt',
              newContents,
              oldContents
            )
          );
        } finally {
          renderer.cleanUp();
        }
      });

      test('are not added when line diffs are off', () => {
        withSession(diffStyle, 'none', (renderer, diff) => {
          editLine(renderer, diff, 2, 'let third = delta(3, 5);');
          expect(getHighlights(renderer, diff)).toEqual([]);
        });
      });
    });
  }
});
