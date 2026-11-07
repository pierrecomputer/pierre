import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Element as HASTElement } from 'hast';

import { TextDocument } from '../src/editor/textDocument';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { DiffLayout } from '../src/layout/DiffLayout';
import { columnCells } from '../src/layout/RowSpec';
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

// A renderer with the default decorations and annotation element.
const host = new DiffHunksRenderer<undefined>();

function annotationMaps<LAnnotation = undefined>(
  annotations: DiffLineAnnotation<LAnnotation>[] = []
) {
  const deletionAnnotations: AnnotationLineMap<LAnnotation> = {};
  const additionAnnotations: AnnotationLineMap<LAnnotation> = {};
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
        const layout = new DiffLayout({
          diffStyle: variant.diffStyle,
          expandUnchanged: variant.expandUnchanged,
          expansionLineCount: 100,
          collapsedContextThreshold: 1,
          hunkSeparators: variant.hunkSeparators,
          lineDiffType: 'word-alt',
          maxLineDiffLength: 1000,
          canHydrateContext: false,
        });
        const rows = new RowSource({
          deletionRows: result.code.deletionLines,
          additionRows: result.code.additionLines,
          additionLines: diff.additionLines,
          lineIds: model.live ? model.lineIds() : undefined,
        });
        const actual = layout.layout({
          host,
          expandedHunks: renderer.getExpandedHunksMap(),
          model,
          rows,
          renderRange: RANGES[variant.range],
          ...annotationMaps(fixture.annotations),
          annotationSlotName: getLineAnnotationName,
          includeTrailingNewline: model.live,
          showNoNewlineMarkers: !model.live,
        });

        for (const type of ['unified', 'deletions', 'additions'] as const) {
          const specs = actual.columns[type];
          const expectedSpecs = expected.columns[type];
          expect(specs == null).toBe(expectedSpecs == null);
          if (specs == null || expectedSpecs == null) {
            continue;
          }
          const { gutter: expectedGutter, content: expectedContent } =
            columnCells(expectedSpecs);
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
    const layout = new DiffLayout({
      diffStyle: 'split',
      expandUnchanged: true,
      expansionLineCount: 100,
      collapsedContextThreshold: 1,
      hunkSeparators: 'line-info',
      lineDiffType: 'word-alt',
      maxLineDiffLength: 1000,
      canHydrateContext: false,
    });
    const model = DiffModel.startEditSession(diff);
    const rows = new RowSource({
      deletionRows: result.code.deletionLines,
      additionRows: result.code.additionLines,
      additionLines: diff.additionLines,
      lineIds: model.live ? model.lineIds() : undefined,
    });
    const input = {
      host,
      model,
      expandedHunks: new Map(),
      rows,
      renderRange: RANGES.all,
      ...annotationMaps(annotations),
      annotationSlotName: getLineAnnotationName,
      includeTrailingNewline: model.live,
      showNoNewlineMarkers: !model.live,
    };
    const keysOf = (specs: { key: string }[]) => specs.map((spec) => spec.key);
    // The session's model renders the empty line after the final line break
    // as a row of its own, keyed d2 on the old side.
    const before = layout.layout(input);
    expect(keysOf(before.columns.deletions!)).toEqual([
      'd0',
      'd1',
      'ann:d1',
      'd2',
    ]);
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
    ).toEqual(['d0', 'd1', 'ann:d1', 'd2']);
  });

  test('content cells that are not document lines are never editable', () => {
    const diff = parseDiffFromFile(
      { name: 'a.ts', contents: 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n' },
      { name: 'a.ts', contents: 'one\ntwo\nthree\nfour\nfive\nsix\nSEVEN\n' }
    );
    const annotations: DiffLineAnnotation<undefined>[] = [
      { lineNumber: 7, side: 'deletions', metadata: undefined },
    ];
    const result = renderDiffWithHighlighter(diff, highlighter, {
      theme: 'github-light',
      useTokenTransformer: false,
      tokenizeMaxLineLength: 1000,
      lineDiffType: 'none',
      maxLineDiffLength: 1000,
    });
    // A read-only model: no editor is attached, and the rows are still marked.
    const model = DiffModel.fromDiff(diff);
    const rows = new RowSource({
      deletionRows: result.code.deletionLines,
      additionRows: result.code.additionLines,
      additionLines: diff.additionLines,
      lineIds: model.live ? model.lineIds() : undefined,
    });
    for (const diffStyle of ['split', 'unified'] as const) {
      const layout = new DiffLayout({
        diffStyle,
        expandUnchanged: false,
        expansionLineCount: 100,
        collapsedContextThreshold: 1,
        hunkSeparators: 'line-info',
        lineDiffType: 'word-alt',
        maxLineDiffLength: 1000,
        canHydrateContext: false,
      });
      const { columns } = layout.layout({
        host,
        expandedHunks: new Map(),
        model,
        rows,
        renderRange: RANGES.all,
        ...annotationMaps(annotations),
        annotationSlotName: getLineAnnotationName,
        includeTrailingNewline: model.live,
        showNoNewlineMarkers: !model.live,
      });
      const specs =
        diffStyle === 'split' ? columns.deletions! : columns.unified!;
      const keys = specs.map((spec) => spec.key);
      expect(keys.some((key) => key.startsWith('sep:'))).toBe(true);
      expect(keys.some((key) => key.startsWith('ann:'))).toBe(true);
      for (const spec of specs) {
        const readOnly =
          spec.key.startsWith('sep:') ||
          spec.key.startsWith('ann:') ||
          (diffStyle === 'unified' && spec.key.startsWith('d'));
        expect(spec.content.properties?.contenteditable).toBe(
          readOnly ? 'false' : undefined
        );
        expect(spec.gutter.properties?.contenteditable).toBeUndefined();
      }
    }
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
    const layout = new DiffLayout({
      diffStyle: 'split',
      expandUnchanged: true,
      expansionLineCount: 100,
      collapsedContextThreshold: 1,
      hunkSeparators: 'line-info',
      lineDiffType: 'none',
      maxLineDiffLength: 1000,
      canHydrateContext: false,
    });
    const model = DiffModel.startEditSession(diff);
    const rows = new RowSource({
      deletionRows: result.code.deletionLines,
      additionRows: result.code.additionLines,
      additionLines: diff.additionLines,
      lineIds: model.live ? model.lineIds() : undefined,
    });
    rows.setTokens(model.lineId(0), [[0, '#ff0000', 'bar']]);
    const actual = layout.layout({
      host,
      expandedHunks: new Map(),
      model,
      rows,
      renderRange: RANGES.all,
      ...annotationMaps(),
      annotationSlotName: getLineAnnotationName,
      includeTrailingNewline: model.live,
      showNoNewlineMarkers: !model.live,
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
    const layout = new DiffLayout({
      diffStyle: 'split',
      expandUnchanged: true,
      expansionLineCount: 100,
      collapsedContextThreshold: 1,
      hunkSeparators: 'line-info',
      lineDiffType: 'word-alt',
      maxLineDiffLength: 1000,
      canHydrateContext: false,
    });
    const model = DiffModel.fromDiff(diff);
    const input = {
      host,
      model,
      expandedHunks: new Map(),
      rows: new RowSource({
        deletionRows: result.code.deletionLines,
        additionRows: result.code.additionLines,
        additionLines: diff.additionLines,
        lineIds: model.live ? model.lineIds() : undefined,
      }),
      renderRange: RANGES.all,
      ...annotationMaps(),
      annotationSlotName: getLineAnnotationName,
      includeTrailingNewline: model.live,
      showNoNewlineMarkers: !model.live,
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

  for (const diffStyle of ['split', 'unified'] as const) {
    test(`${diffStyle}: marked lines are laid out as a full layout would, without a walk`, () => {
      const { diff } = FIXTURES[0];
      const result = renderDiffWithHighlighter(diff, highlighter, {
        theme: 'github-light',
        useTokenTransformer: true,
        tokenizeMaxLineLength: 1000,
        lineDiffType: 'none',
        maxLineDiffLength: 1000,
      });
      const layout = new DiffLayout({
        diffStyle,
        expandUnchanged: true,
        expansionLineCount: 100,
        collapsedContextThreshold: 1,
        hunkSeparators: 'line-info',
        lineDiffType: 'word-alt',
        maxLineDiffLength: 1000,
        canHydrateContext: false,
      });
      const model = DiffModel.startEditSession(diff);
      const input = {
        host,
        model,
        expandedHunks: new Map(),
        rows: new RowSource({
          deletionRows: result.code.deletionLines,
          additionRows: result.code.additionLines,
          additionLines: diff.additionLines,
          lineIds: model.lineIds(),
        }),
        renderRange: RANGES.all,
        ...annotationMaps(),
        annotationSlotName: getLineAnnotationName,
        includeTrailingNewline: true,
        showNoNewlineMarkers: false,
      };
      // Marks before any layout change nothing: the first layout walks.
      layout.markLines([2]);
      expect(layout.layout(input).patched).toBeUndefined();

      const document = new TextDocument<'file-diff', undefined>(
        'inmemory://lines',
        diff.additionLines.join(''),
        'typescript'
      );
      const change = model.applyChange(
        document.applyEdits([
          {
            range: {
              start: { line: 2, character: 6 },
              end: { line: 2, character: 6 },
            },
            newText: 'x',
          },
        ])!,
        document
      );
      expect(change.hunksChanged).toBe(false);
      layout.markLines(change.changedLines);
      const laidOut = layout.layout(input);
      const patched = laidOut.patched!;
      expect(patched).toBeDefined();
      // What a fresh layout of the same input walks to.
      const full = new DiffLayout({
        diffStyle,
        expandUnchanged: true,
        expansionLineCount: 100,
        collapsedContextThreshold: 1,
        hunkSeparators: 'line-info',
        lineDiffType: 'word-alt',
        maxLineDiffLength: 1000,
        canHydrateContext: false,
      }).layout(input);

      // The changed line's row and its pair's row, and nothing else.
      const patchedSpecs = [
        ...(patched.unified ?? []),
        ...(patched.deletions ?? []),
        ...(patched.additions ?? []),
      ];
      expect(
        patchedSpecs.map((spec) => spec.key).sort((a, b) => a.localeCompare(b))
      ).toEqual([`a${model.lineId(2)}`, 'd2']);
      // The columns hold the same rows, in the same order, as the walk.
      for (const type of ['unified', 'deletions', 'additions'] as const) {
        const column = laidOut.columns[type];
        const walked = full.columns[type];
        expect(column?.length).toBe(walked?.length);
        for (const [index, spec] of (column ?? []).entries()) {
          expect(spec.key).toBe(walked![index].key);
          expect(hastToHtml([spec.content])).toBe(
            hastToHtml([walked![index].content])
          );
        }
      }
      const addition = patchedSpecs.find((spec) => spec.key.startsWith('a'));
      expect(hastToHtml([addition!.content])).toContain('xchanged3');
      // A line without a row on screen has nothing to rebuild: every column
      // is patched with no rows. Nothing marked means a walk.
      layout.markLines([999]);
      const nothing = layout.layout(input).patched!;
      for (const type of ['unified', 'deletions', 'additions'] as const) {
        expect(nothing[type]).toEqual(
          full.columns[type] == null ? undefined : []
        );
      }
      expect(layout.layout(input).patched).toBeUndefined();
    });
  }

  test('unified: a marked line off screen still rebuilds its pair row on screen', () => {
    const { diff } = FIXTURES[0];
    const result = renderDiffWithHighlighter(diff, highlighter, {
      theme: 'github-light',
      useTokenTransformer: true,
      tokenizeMaxLineLength: 1000,
      lineDiffType: 'none',
      maxLineDiffLength: 1000,
    });
    const layout = new DiffLayout({
      diffStyle: 'unified',
      expandUnchanged: true,
      expansionLineCount: 100,
      collapsedContextThreshold: 1,
      hunkSeparators: 'line-info',
      lineDiffType: 'word-alt',
      maxLineDiffLength: 1000,
      canHydrateContext: false,
    });
    const model = DiffModel.startEditSession(diff);
    // The third unified row is the deletion of line 3; its addition is the
    // row after, outside this window.
    const input = {
      host,
      model,
      expandedHunks: new Map(),
      rows: new RowSource({
        deletionRows: result.code.deletionLines,
        additionRows: result.code.additionLines,
        additionLines: diff.additionLines,
        lineIds: model.lineIds(),
      }),
      renderRange: {
        startingLine: 2,
        totalLines: 1,
        bufferBefore: 0,
        bufferAfter: 0,
      },
      ...annotationMaps(),
      annotationSlotName: getLineAnnotationName,
      includeTrailingNewline: true,
      showNoNewlineMarkers: false,
    };
    expect(
      layout.layout(input).columns.unified?.map((spec) => spec.key)
    ).toEqual(['d2']);

    const document = new TextDocument<'file-diff', undefined>(
      'inmemory://lines',
      diff.additionLines.join(''),
      'typescript'
    );
    const change = model.applyChange(
      document.applyEdits([
        {
          range: {
            start: { line: 2, character: 6 },
            end: { line: 2, character: 6 },
          },
          newText: 'x',
        },
      ])!,
      document
    );
    layout.markLines(change.changedLines);
    // The deletion's marks come from the edited addition's text.
    expect(
      layout.layout(input).patched?.unified?.map((spec) => spec.key)
    ).toEqual(['d2']);
  });
});
