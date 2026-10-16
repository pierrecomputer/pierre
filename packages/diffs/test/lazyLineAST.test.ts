import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { toHtml } from 'hast-util-to-html';

import { DEFAULT_RENDER_RANGE } from '../src/constants';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { FileRenderer } from '../src/renderers/FileRenderer';
import type { DiffsHighlighter, RenderDiffOptions } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { processPatch } from '../src/utils/parsePatchFiles';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';
import { renderTokenLines } from '../src/utils/renderTokenLines';

let highlighter: DiffsHighlighter;
beforeAll(async () => {
  await disposeHighlighter();
  highlighter = await getSharedHighlighter({
    preferredHighlighter: 'highlights',
    themes: ['pierre-dark'],
    langs: ['typescript'],
  });
});
afterAll(disposeHighlighter);

const file = {
  name: 'example.ts',
  contents:
    '/* start\nconst inside = "comment";\nend */\nconst outside = "code";\n',
};
const options: RenderDiffOptions = {
  theme: 'pierre-dark',
  useTokenTransformer: false,
  tokenizeMaxLineLength: 1000,
  lineDiffType: 'word-alt',
  maxLineDiffLength: 1000,
};

test('windowed highlighting constructs only accessed rows and caches them', () => {
  const rendered: number[] = [];
  const rows = renderTokenLines(
    Array.from({ length: 1000 }, (_, index) => [
      { content: `line ${index}`, offset: index * 10 },
    ]),
    {
      lazyLineAST: true,
      state: {
        lineInfo(line) {
          rendered.push(line);
          return { type: 'context', lineIndex: line - 1, lineNumber: line };
        },
      },
    }
  );
  expect(rows).toHaveLength(1000);
  expect(rendered).toEqual([]);
  const first = rows[0];
  const later = rows[900];
  expect(rendered).toEqual([1, 901]);
  expect(rows[0]).toBe(first);
  expect(rows[900]).toBe(later);
  expect(rendered).toEqual([1, 901]);
});

test('lazy rows preserve decorations, serialization, and array edits', () => {
  const tokens = [
    [{ content: 'alpha', offset: 0 }],
    [{ content: 'beta', offset: 6 }],
    [{ content: 'gamma', offset: 11 }],
  ];
  const options = {
    decorations: [{ start: 2, end: 8, properties: { 'data-decoration': '' } }],
    lineOffsets: [0, 6, 11],
  };
  const expected = renderTokenLines(tokens, options);
  const lazyOptions = { ...options, lazyLineAST: true };
  expect(JSON.stringify(renderTokenLines(tokens, lazyOptions))).toBe(
    JSON.stringify(expected)
  );
  expect(structuredClone(renderTokenLines(tokens, lazyOptions))).toEqual(
    expected
  );

  const rows = renderTokenLines(tokens, lazyOptions);
  rows[0] = { type: 'text', value: 'replaced' };
  rows.splice(1, 0, { type: 'text', value: 'inserted' });
  expect(rows).toEqual([
    { type: 'text', value: 'replaced' },
    { type: 'text', value: 'inserted' },
    expected[1],
    expected[2],
  ]);
});

test('lazy file rows retain preceding lexical state and eager SSR output', () => {
  const expected = renderFileWithHighlighter(file, highlighter, options);
  const highlight = spyOn(highlighter, 'codeToTokens');
  try {
    const result = renderFileWithHighlighter(file, highlighter, options, {
      forcePlainText: false,
      startingLine: 1,
      totalLines: 1,
      lazyLineAST: true,
    });
    expect(highlight.mock.calls[0][0]).toBe(file.contents);
    expect(
      Object.getOwnPropertyDescriptor(result.code, '0')?.get
    ).toBeDefined();
    expect(result.code[1]).toEqual(expected.code[1]);
    expect(result.code[3]).toEqual(expected.code[3]);
    expect(
      Object.getOwnPropertyDescriptor(result.code, '0')?.get
    ).toBeDefined();
    expect(toHtml(result.code)).toBe(toHtml(expected.code));
    expect(highlight).toHaveBeenCalledTimes(1);
  } finally {
    highlight.mockRestore();
  }
});

test('full and partial diffs defer both sides without losing line decorations', () => {
  const full = parseDiffFromFile(file, {
    ...file,
    contents: file.contents
      .replace('inside', 'changed')
      .replace('outside', 'after'),
  });
  const partial = processPatch(
    '--- a/example.ts\n+++ b/example.ts\n@@ -2,2 +2,2 @@\n-const old = 1;\n+const next = 2;\n const context = 3;\n@@ -20,2 +20,2 @@\n const before = 4;\n-const last = 5;\n+const end = 6;\n'
  ).files[0];
  expect(partial.isPartial).toBe(true);
  for (const diff of [full, partial]) {
    const expected = renderDiffWithHighlighter(diff, highlighter, options);
    const result = renderDiffWithHighlighter(diff, highlighter, options, {
      forcePlainText: false,
      lazyLineAST: true,
    });
    for (const side of ['deletionLines', 'additionLines'] as const) {
      const rows = result.code[side];
      const last = rows.length - 1;
      expect(Object.getOwnPropertyDescriptor(rows, '0')?.get).toBeDefined();
      expect(rows[last]).toEqual(expected.code[side][last]);
      expect(Object.getOwnPropertyDescriptor(rows, '0')?.get).toBeDefined();
      expect(toHtml(rows)).toBe(toHtml(expected.code[side]));
    }
  }
});

test('plain-text windows retain sparse absolute indexes', () => {
  const result = renderFileWithHighlighter(file, highlighter, options, {
    forcePlainText: true,
    startingLine: 2,
    totalLines: 1,
    lazyLineAST: true,
  });
  expect(0 in result.code).toBe(false);
  expect(1 in result.code).toBe(false);
  expect(toHtml(result.code[2])).toContain('data-line="3"');
  expect(toHtml(result.code[2])).toContain('end */');
});

test('cached file and diff renderers scroll across lazy rows without retokenizing', () => {
  const fileRenderer = new FileRenderer(options);
  const diffRenderer = new DiffHunksRenderer({
    ...options,
    expandUnchanged: true,
  });
  const diff = parseDiffFromFile(file, {
    ...file,
    contents: file.contents.replace('inside', 'changed'),
  });
  const highlight = spyOn(highlighter, 'codeToTokens');
  const firstRange = { ...DEFAULT_RENDER_RANGE, totalLines: 1 };
  const laterRange = { ...firstRange, startingLine: 3 };
  try {
    expect(fileRenderer.renderFile(file, firstRange)?.contentAST).toHaveLength(
      1
    );
    expect(highlight).toHaveBeenCalledTimes(1);
    const later = fileRenderer.renderFile(file, laterRange);
    expect(toHtml(later?.contentAST ?? [])).toContain('outside');
    expect(highlight).toHaveBeenCalledTimes(1);
    const full = fileRenderer.renderFile(file);
    expect(full?.contentAST).toHaveLength(5);
    expect(highlight).toHaveBeenCalledTimes(1);

    expect(diffRenderer.renderDiff(diff, firstRange)).toBeDefined();
    expect(highlight).toHaveBeenCalledTimes(3);
    const laterDiff = diffRenderer.renderDiff(diff, laterRange);
    expect(toHtml(laterDiff?.additionsContentAST ?? [])).toContain('outside');
    expect(highlight).toHaveBeenCalledTimes(3);
  } finally {
    highlight.mockRestore();
    fileRenderer.cleanUp();
    diffRenderer.cleanUp();
  }
});

test('editing after a lazy render regenerates writable editor rows', () => {
  const renderer = new FileRenderer(options);
  const session = { ...file };
  const range = { ...DEFAULT_RENDER_RANGE, totalLines: 1 };
  try {
    renderer.renderFile(session, range);
    renderer.beginEditSession(session);
    const editing = renderer.renderFile(session, range);
    expect(toHtml(editing?.contentAST ?? [])).toContain('data-char');
    renderer.updateRenderCache(
      new Map([[3, [[0, '#fff', 'const edited = 3;']]]]),
      'dark'
    );
    const later = renderer.renderFile(session, { ...range, startingLine: 3 });
    expect(toHtml(later?.contentAST ?? [])).toContain('edited');
    expect(renderer.editorRenderReady()).toBe(true);
  } finally {
    renderer.cleanUp();
  }
});

test('async windows and full-file SSR produce the same rows as eager rendering', async () => {
  const renderer = new FileRenderer(options);
  try {
    const window = await renderer.asyncRender(file, {
      ...DEFAULT_RENDER_RANGE,
      startingLine: 1,
      totalLines: 2,
    });
    const eager = renderFileWithHighlighter(file, highlighter, options);
    expect(toHtml(window.contentAST)).toBe(toHtml(eager.code.slice(1, 3)));
    const full = await renderer.asyncRender(file);
    expect(toHtml(full.contentAST)).toBe(toHtml(eager.code));
  } finally {
    renderer.cleanUp();
  }
});
