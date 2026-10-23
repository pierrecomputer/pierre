import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Element as HASTElement } from 'hast';

import { TextDocument } from '../src/editor/textDocument';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { columnCells, DiffLayout } from '../src/layout/DiffLayout';
import type {
  LineDecoration,
  SplitLineDecorationProps,
  UnifiedLineDecorationProps,
} from '../src/layout/RowSpec';
import { DiffModel } from '../src/model/DiffModel';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { RowSource } from '../src/rows/RowSource';
import type {
  AnnotationLineMap,
  DiffLineAnnotation,
  DiffsHighlighter,
  FileDiffMetadata,
  HunkSeparators,
  RenderRange,
} from '../src/types';
import { createAnnotationElement } from '../src/utils/createAnnotationElement';
import { getLineAnnotationName } from '../src/utils/getLineAnnotationName';
import { hastToHtml } from '../src/utils/hastToHtml';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';

let highlighter: DiffsHighlighter;

beforeAll(async () => {
  highlighter = await getSharedHighlighter({
    themes: ['github-light'],
    langs: ['text', 'typescript'],
  });
});

afterAll(async () => {
  await disposeHighlighter();
});

function makeLines(
  count: number,
  edits: Record<number, string> = {},
  prefix = 'const value'
): string[] {
  return Array.from(
    { length: count },
    (_, index) =>
      (edits[index + 1] ?? `${prefix}${index + 1} = ${index};`) + '\n'
  );
}

interface Fixture {
  name: string;
  diff: FileDiffMetadata;
  annotations?: DiffLineAnnotation<undefined>[];
}

const FIXTURES: Fixture[] = [
  {
    name: 'two changed lines',
    diff: parseDiffFromFile(
      { name: 'a.ts', contents: makeLines(40).join('') },
      {
        name: 'a.ts',
        contents: makeLines(40, {
          3: 'const changed3 = 2;',
          20: 'let changed20 = 19;',
        }).join(''),
      }
    ),
  },
  {
    name: 'an insertion and a deletion',
    diff: parseDiffFromFile(
      { name: 'a.ts', contents: makeLines(40).join('') },
      {
        name: 'a.ts',
        contents: [
          ...makeLines(10),
          'const inserted1 = 1;\n',
          'const inserted2 = 2;\n',
          ...makeLines(40).slice(10, 25),
          ...makeLines(40).slice(27),
        ].join(''),
      }
    ),
  },
  {
    name: 'a new file',
    diff: parseDiffFromFile(null, {
      name: 'b.ts',
      contents: makeLines(12).join(''),
    }),
  },
  {
    name: 'files without a final newline',
    diff: parseDiffFromFile(
      { name: 'c.ts', contents: makeLines(6).join('').replace(/\n$/, '') },
      {
        name: 'c.ts',
        contents: makeLines(6, { 6: 'const last = 6' })
          .join('')
          .replace(/\n$/, ''),
      }
    ),
  },
  {
    name: 'annotations on both sides and on the file',
    diff: parseDiffFromFile(
      { name: 'a.ts', contents: makeLines(40).join('') },
      {
        name: 'a.ts',
        contents: makeLines(40, {
          3: 'const changed3 = 2;',
          20: 'let changed20 = 19;',
        }).join(''),
      }
    ),
    annotations: [
      { lineNumber: 0, side: 'additions', metadata: undefined },
      { lineNumber: 3, side: 'deletions', metadata: undefined },
      { lineNumber: 3, side: 'additions', metadata: undefined },
      { lineNumber: 21, side: 'additions', metadata: undefined },
    ],
  },
];

const RANGES: Record<string, RenderRange> = {
  all: {
    startingLine: 0,
    totalLines: Infinity,
    bufferBefore: 0,
    bufferAfter: 0,
  },
  window: { startingLine: 2, totalLines: 9, bufferBefore: 1, bufferAfter: 3 },
};

// The default decorations, as DiffHunksRenderer declares them.
const hooks = {
  unifiedLineDecoration({
    lineType,
  }: UnifiedLineDecorationProps): LineDecoration {
    return {
      gutterLineType: lineType,
      contentProperties: { 'data-line-type': lineType },
    };
  },
  splitLineDecoration({
    side,
    type,
  }: SplitLineDecorationProps): LineDecoration {
    const lineType =
      type === 'change'
        ? side === 'deletions'
          ? 'change-deletion'
          : 'change-addition'
        : type;
    return {
      gutterLineType: lineType,
      contentProperties: { 'data-line-type': lineType },
    };
  },
  annotationElement: createAnnotationElement,
};

function annotationMaps(annotations: DiffLineAnnotation<undefined>[] = []) {
  const deletionAnnotations: AnnotationLineMap<undefined> = {};
  const additionAnnotations: AnnotationLineMap<undefined> = {};
  for (const annotation of annotations) {
    const map =
      annotation.side === 'deletions'
        ? deletionAnnotations
        : additionAnnotations;
    (map[annotation.lineNumber] ??= []).push(annotation);
  }
  return { deletionAnnotations, additionAnnotations };
}

interface Variant {
  diffStyle: 'split' | 'unified';
  expandUnchanged: boolean;
  hunkSeparators: HunkSeparators;
  range: keyof typeof RANGES;
  expand?: boolean;
}

const VARIANTS: Variant[] = [
  {
    diffStyle: 'split',
    expandUnchanged: false,
    hunkSeparators: 'line-info',
    range: 'all',
  },
  {
    diffStyle: 'unified',
    expandUnchanged: false,
    hunkSeparators: 'line-info',
    range: 'all',
  },
  {
    diffStyle: 'split',
    expandUnchanged: true,
    hunkSeparators: 'line-info',
    range: 'all',
  },
  {
    diffStyle: 'unified',
    expandUnchanged: true,
    hunkSeparators: 'line-info',
    range: 'all',
  },
  {
    diffStyle: 'split',
    expandUnchanged: true,
    hunkSeparators: 'line-info',
    range: 'window',
  },
  {
    diffStyle: 'unified',
    expandUnchanged: true,
    hunkSeparators: 'line-info',
    range: 'window',
  },
  {
    diffStyle: 'split',
    expandUnchanged: false,
    hunkSeparators: 'simple',
    range: 'all',
  },
  {
    diffStyle: 'split',
    expandUnchanged: false,
    hunkSeparators: 'metadata',
    range: 'all',
  },
  {
    diffStyle: 'split',
    expandUnchanged: false,
    hunkSeparators: 'line-info',
    range: 'all',
    expand: true,
  },
  {
    diffStyle: 'unified',
    expandUnchanged: false,
    hunkSeparators: 'line-info',
    range: 'all',
    expand: true,
  },
];

function variantName(variant: Variant): string {
  return `${variant.diffStyle}, expandUnchanged ${variant.expandUnchanged}, ${variant.hunkSeparators}, ${variant.range}${variant.expand === true ? ', expanded hunk' : ''}`;
}

function columnHtml(cells: { gutter: unknown[]; content: unknown[] }) {
  return {
    gutter: hastToHtml(cells.gutter as HASTElement[]),
    content: hastToHtml(cells.content as HASTElement[]),
  };
}

describe('DiffLayout matches processDiffResult', () => {
  for (const fixture of FIXTURES) {
    for (const variant of VARIANTS) {
      test(`${fixture.name}: ${variantName(variant)}`, async () => {
        const { diff } = fixture;
        const baseOptions = {
          theme: 'github-light' as const,
          diffStyle: variant.diffStyle,
          expandUnchanged: variant.expandUnchanged,
          hunkSeparators: variant.hunkSeparators,
          lineDiffType: 'word-alt' as const,
        };
        const renderer = new DiffHunksRenderer<undefined>(baseOptions);
        renderer.setLineAnnotations(fixture.annotations ?? []);
        await renderer.asyncRender(diff);
        if (variant.expand === true) {
          renderer.expandHunk(1, 'down', 5);
        }
        const expected = renderer.renderDiff(diff, RANGES[variant.range]);
        expect(expected).toBeDefined();
        if (expected == null) return;

        // The new pipeline marks rows itself, so its highlight result has
        // no marks.
        const result = renderDiffWithHighlighter(diff, highlighter, {
          theme: 'github-light',
          useTokenTransformer: false,
          tokenizeMaxLineLength: 1000,
          lineDiffType: 'none',
          maxLineDiffLength: 1000,
        });
        const model = DiffModel.fromDiff(diff);
        if (variant.expand === true) {
          model.expandHunk(1, 'down', 5);
        }
        const layout = new DiffLayout(
          {
            diffStyle: variant.diffStyle,
            expandUnchanged: variant.expandUnchanged,
            expansionLineCount: 100,
            collapsedContextThreshold: 1,
            hunkSeparators: variant.hunkSeparators,
            lineDiffType: 'word-alt',
            maxLineDiffLength: 1000,
            canHydrateContext: false,
          },
          hooks
        );
        const rows = new RowSource({
          deletionRows: result.code.deletionLines,
          originalAdditionRows: result.code.additionLines,
          originalAdditionLines: diff.additionLines,
        });
        const actual = layout.layout({
          model,
          rows,
          renderRange: RANGES[variant.range],
          ...annotationMaps(fixture.annotations),
          annotationSlotName: getLineAnnotationName,
        });

        for (const type of ['unified', 'deletions', 'additions'] as const) {
          const specs = actual.columns[type];
          const expectedGutter =
            type === 'unified'
              ? expected.unifiedGutterAST
              : type === 'deletions'
                ? expected.deletionsGutterAST
                : expected.additionsGutterAST;
          const expectedContent =
            type === 'unified'
              ? expected.unifiedContentAST
              : type === 'deletions'
                ? expected.deletionsContentAST
                : expected.additionsContentAST;
          expect(specs == null).toBe(expectedContent == null);
          if (
            specs == null ||
            expectedGutter == null ||
            expectedContent == null
          ) {
            continue;
          }
          // Row by row first, so a mismatch names the row.
          const actualCells = columnCells(specs);
          const rowCount = Math.max(
            actualCells.content.length,
            expectedContent.length
          );
          for (let index = 0; index < rowCount; index++) {
            const actualRow = actualCells.content[index];
            const expectedRow = expectedContent[index];
            expect(
              `${type} row ${index}: ${actualRow == null ? '(missing)' : hastToHtml(actualRow as HASTElement)}`
            ).toBe(
              `${type} row ${index}: ${expectedRow == null ? '(missing)' : hastToHtml(expectedRow as HASTElement)}`
            );
          }
          const cells = columnHtml(actualCells);
          expect(cells.gutter).toBe(
            hastToHtml(expectedGutter as HASTElement[])
          );
          expect(cells.content).toBe(
            hastToHtml(expectedContent as HASTElement[])
          );
          // Every row has a key, and keys are unique within a column.
          const keys = specs.map((spec) => spec.key);
          expect(new Set(keys).size).toBe(keys.length);
        }
        expect(actual.rowCount).toBe(expected.rowCount);
        expect(actual.totalLines).toBe(expected.totalLines);
        expect(actual.hunkData).toEqual(expected.hunkData);
        renderer.cleanUp();
      });
    }
  }

  test('annotation rows keep their key when the other side is re-paired', () => {
    const diff = parseDiffFromFile(
      { name: 'a.ts', contents: 'old one\nold two\n' },
      { name: 'a.ts', contents: 'new one\nnew two\n' }
    );
    const annotations: DiffLineAnnotation<undefined>[] = [
      { lineNumber: 2, side: 'deletions', metadata: undefined },
    ];
    const result = renderDiffWithHighlighter(diff, highlighter, {
      theme: 'github-light',
      useTokenTransformer: true,
      tokenizeMaxLineLength: 1000,
      lineDiffType: 'none',
      maxLineDiffLength: 1000,
    });
    const layout = new DiffLayout(
      {
        diffStyle: 'split',
        expandUnchanged: true,
        expansionLineCount: 100,
        collapsedContextThreshold: 1,
        hunkSeparators: 'line-info',
        lineDiffType: 'word-alt',
        maxLineDiffLength: 1000,
        canHydrateContext: false,
      },
      hooks
    );
    const model = DiffModel.startSession(diff);
    const rows = new RowSource({
      deletionRows: result.code.deletionLines,
      originalAdditionRows: result.code.additionLines,
      originalAdditionLines: diff.additionLines,
    });
    const input = {
      model,
      rows,
      renderRange: RANGES.all,
      ...annotationMaps(annotations),
      annotationSlotName: getLineAnnotationName,
    };
    const keysOf = (specs: { key: string }[]) => specs.map((spec) => spec.key);
    const before = layout.layout(input);
    expect(keysOf(before.columns.deletions!)).toEqual(['d0', 'd1', 'ann:d1']);
    const document = new TextDocument<'file-diff', undefined>(
      'inmemory://ann',
      diff.additionLines.join(''),
      'typescript'
    );
    model.applyChange(
      document.applyEdits([
        {
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 3 },
          },
          newText: '\ninsert',
        },
      ])!,
      document
    );
    const after = layout.layout(input);
    // The inserted new line adds a filler row to the deletions column; the
    // deletion rows and the annotation under old line 2 keep their keys.
    expect(
      keysOf(after.columns.deletions!).filter((key) => !key.startsWith('buf:'))
    ).toEqual(['d0', 'd1', 'ann:d1']);
  });

  test('token rows get their line attributes in the same order as highlighted rows', () => {
    const diff = parseDiffFromFile(
      { name: 'a.ts', contents: 'foo\n' },
      { name: 'a.ts', contents: 'bar\n' }
    );
    const result = renderDiffWithHighlighter(diff, highlighter, {
      theme: 'github-light',
      useTokenTransformer: true,
      tokenizeMaxLineLength: 1000,
      lineDiffType: 'none',
      maxLineDiffLength: 1000,
    });
    const layout = new DiffLayout(
      {
        diffStyle: 'split',
        expandUnchanged: true,
        expansionLineCount: 100,
        collapsedContextThreshold: 1,
        hunkSeparators: 'line-info',
        lineDiffType: 'none',
        maxLineDiffLength: 1000,
        canHydrateContext: false,
      },
      hooks
    );
    const model = DiffModel.startSession(diff);
    const rows = new RowSource({
      deletionRows: result.code.deletionLines,
      originalAdditionRows: result.code.additionLines,
      originalAdditionLines: diff.additionLines,
    });
    rows.setTokens(model.lineId(0), [[0, '#ff0000', 'bar']]);
    const actual = layout.layout({
      model,
      rows,
      renderRange: RANGES.all,
      ...annotationMaps(),
      annotationSlotName: getLineAnnotationName,
    });
    const [deletionRow] = columnCells(actual.columns.deletions!).content;
    const [additionRow] = columnCells(actual.columns.additions!).content;
    const lineAttributes = new Set([
      'data-line',
      'data-alt-line',
      'data-line-type',
      'data-line-index',
    ]);
    const attributeOrder = (row: unknown) =>
      Object.keys((row as HASTElement).properties).filter((key) =>
        lineAttributes.has(key)
      );
    expect(attributeOrder(additionRow)).toEqual(attributeOrder(deletionRow));
    expect(attributeOrder(additionRow)).toEqual([
      'data-line',
      'data-alt-line',
      'data-line-type',
      'data-line-index',
    ]);
  });

  test('a second layout of the same input returns the same row objects', () => {
    const { diff } = FIXTURES[0];
    const result = renderDiffWithHighlighter(diff, highlighter, {
      theme: 'github-light',
      useTokenTransformer: false,
      tokenizeMaxLineLength: 1000,
      lineDiffType: 'none',
      maxLineDiffLength: 1000,
    });
    const layout = new DiffLayout(
      {
        diffStyle: 'split',
        expandUnchanged: true,
        expansionLineCount: 100,
        collapsedContextThreshold: 1,
        hunkSeparators: 'line-info',
        lineDiffType: 'word-alt',
        maxLineDiffLength: 1000,
        canHydrateContext: false,
      },
      hooks
    );
    const input = {
      model: DiffModel.fromDiff(diff),
      rows: new RowSource({
        deletionRows: result.code.deletionLines,
        originalAdditionRows: result.code.additionLines,
        originalAdditionLines: diff.additionLines,
      }),
      renderRange: RANGES.all,
      ...annotationMaps(),
      annotationSlotName: getLineAnnotationName,
    };
    const first = layout.layout(input);
    const second = layout.layout(input);
    for (const type of ['deletions', 'additions'] as const) {
      const a = first.columns[type]!;
      const b = second.columns[type]!;
      expect(b.length).toBe(a.length);
      for (let index = 0; index < a.length; index++) {
        expect(b[index].key).toBe(a[index].key);
        expect(b[index].content).toBe(a[index].content);
      }
    }
  });
});
