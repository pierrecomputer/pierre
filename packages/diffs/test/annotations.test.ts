import { afterAll, describe, expect, test } from 'bun:test';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  parseDiffFromFile,
} from '../src';
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  LineTypes,
  RenderedLine,
  RenderedRow,
} from '../src/types';
import { fileNew, fileOld } from './mocks';
import { rowProperties } from './testUtils';
import {
  annotationProjection,
  assertDefined,
  collectAllElements,
  countAnnotationRows,
  findSlotElements,
  getAnnotationIndex,
  getLineIndex,
  getLineType,
  isAnnotationRow,
  isLineRow,
} from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

const oldFile = { name: 'DiffRenderer.ts', contents: fileOld };
const newFile = { name: 'DiffRenderer.ts', contents: fileNew };

function createDiffWithLeadingSeparator(): FileDiffMetadata {
  const oldLines = Array.from({ length: 40 }, (_, index) => `${index + 1}`);
  const newLines = oldLines.map((line, index) =>
    index === 24 ? 'changed-25' : line
  );
  return parseDiffFromFile(
    { name: 'leading-separator.ts', contents: `${oldLines.join('\n')}\n` },
    { name: 'leading-separator.ts', contents: `${newLines.join('\n')}\n` }
  );
}

function createNoHunkDiff(): FileDiffMetadata {
  return {
    name: 'renamed.ts',
    prevName: 'old-name.ts',
    type: 'rename-pure',
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: false,
    deletionLines: [],
    additionLines: [],
  };
}

function getSlotNames(node: RenderedRow): string[] {
  return findSlotElements(node).map((slot) => {
    const name = slot.properties?.name;
    if (name == null) {
      throw new Error('slot should have a name');
    }
    return name.toString();
  });
}

function getAnnotationIndexes(nodes: RenderedRow[]): string[] {
  return nodes
    .map((node) => getAnnotationIndex(node))
    .filter((index): index is string => index != null);
}

describe('Annotation Rendering', () => {
  const diff = parseDiffFromFile(oldFile, newFile);

  describe('file-level annotations', () => {
    test('render before a leading hunk separator in unified style', async () => {
      const annotations: DiffLineAnnotation<string>[] = [
        { side: 'deletions', lineNumber: 0, metadata: 'old-file' },
        { side: 'additions', lineNumber: 0, metadata: 'new-file' },
      ];
      const renderer = new DiffHunksRenderer<string>({
        diffStyle: 'unified',
      });
      renderer.setLineAnnotations(annotations);

      const { unifiedContentRows } = await renderer.asyncRender(
        createDiffWithLeadingSeparator()
      );
      assertDefined(unifiedContentRows, 'unifiedContentRows should be defined');
      const firstAnnotationIndex =
        unifiedContentRows.findIndex(isAnnotationRow);
      const firstSeparatorIndex = unifiedContentRows.findIndex(
        (node) => rowProperties(node)['data-separator'] != null
      );
      const firstAnnotation = unifiedContentRows[firstAnnotationIndex];
      assertDefined(firstAnnotation, 'firstAnnotation should be defined');

      expect(firstAnnotationIndex).toBe(0);
      expect(firstSeparatorIndex).toBeGreaterThan(firstAnnotationIndex);
      expect(getAnnotationIndex(firstAnnotation)).toBe('-1,-1');
      expect(getSlotNames(firstAnnotation)).toEqual([
        'annotation-deletions-0',
        'annotation-additions-0',
      ]);
    });

    // Highlights every line of the ~700-line fixture on both sides
    // (`expandUnchanged` split render), so it needs more than bun's default 5s
    // per-test timeout to stay reliable under CI contention.
    test(
      'render paired top rows in split style',
      async () => {
        const annotations: DiffLineAnnotation<string>[] = [
          { side: 'deletions', lineNumber: 0, metadata: 'old-file' },
          { side: 'additions', lineNumber: 0, metadata: 'new-file' },
        ];
        const renderer = new DiffHunksRenderer<string>({
          diffStyle: 'split',
          expandUnchanged: true,
        });
        renderer.setLineAnnotations(annotations);

        const { additionsContentRows, deletionsContentRows } =
          await renderer.asyncRender(diff);
        assertDefined(
          additionsContentRows,
          'additionsContentRows should be defined'
        );
        assertDefined(
          deletionsContentRows,
          'deletionsContentRows should be defined'
        );
        const firstAddition = additionsContentRows[0];
        const firstDeletion = deletionsContentRows[0];
        assertDefined(firstAddition, 'firstAddition should be defined');
        assertDefined(firstDeletion, 'firstDeletion should be defined');

        expect(getAnnotationIndex(firstAddition)).toBe('-1,-1');
        expect(getAnnotationIndex(firstDeletion)).toBe('-1,-1');
        expect(getSlotNames(firstAddition)).toEqual(['annotation-additions-0']);
        expect(getSlotNames(firstDeletion)).toEqual(['annotation-deletions-0']);
      },
      { timeout: 15000 }
    );

    test('do not collide with first-row annotation keys in split style', async () => {
      const renderer = new DiffHunksRenderer<string>({ diffStyle: 'split' });
      renderer.setLineAnnotations([
        { side: 'deletions', lineNumber: 0, metadata: 'old-file' },
        { side: 'additions', lineNumber: 0, metadata: 'new-file' },
        { side: 'deletions', lineNumber: 1, metadata: 'old-first-line' },
        { side: 'additions', lineNumber: 1, metadata: 'new-first-line' },
      ]);

      const { additionsContentRows, deletionsContentRows } =
        await renderer.asyncRender(
          parseDiffFromFile(
            { name: 'first-row.ts', contents: 'old\n' },
            { name: 'first-row.ts', contents: 'new\n' }
          )
        );
      assertDefined(
        additionsContentRows,
        'additionsContentRows should be defined'
      );
      assertDefined(
        deletionsContentRows,
        'deletionsContentRows should be defined'
      );

      const annotationIndexes = getAnnotationIndexes(
        deletionsContentRows
      ).concat(getAnnotationIndexes(additionsContentRows));

      expect(
        annotationIndexes.filter((index) => index === '-1,-1')
      ).toHaveLength(2);
      expect(annotationIndexes.filter((index) => index === '0,0')).toHaveLength(
        2
      );
    });

    test('render code columns for no-hunk diffs with only file-level annotations', async () => {
      const annotations: DiffLineAnnotation<string>[] = [
        { side: 'deletions', lineNumber: 0, metadata: 'old-file' },
        { side: 'additions', lineNumber: 0, metadata: 'new-file' },
      ];
      const renderer = new DiffHunksRenderer<string>({ diffStyle: 'split' });
      renderer.setLineAnnotations(annotations);

      const { additionsContentRows, deletionsContentRows, rowCount } =
        await renderer.asyncRender(createNoHunkDiff());
      assertDefined(
        additionsContentRows,
        'additionsContentRows should be defined'
      );
      assertDefined(
        deletionsContentRows,
        'deletionsContentRows should be defined'
      );
      const additionAnnotation = additionsContentRows[0];
      const deletionAnnotation = deletionsContentRows[0];
      assertDefined(additionAnnotation, 'additionAnnotation should be defined');
      assertDefined(deletionAnnotation, 'deletionAnnotation should be defined');

      expect(rowCount).toBe(1);
      expect(getSlotNames(additionAnnotation)).toEqual([
        'annotation-additions-0',
      ]);
      expect(getSlotNames(deletionAnnotation)).toEqual([
        'annotation-deletions-0',
      ]);
    });

    test('do not render in non-top diff render chunks', async () => {
      const renderer = new DiffHunksRenderer<string>({ diffStyle: 'unified' });
      renderer.setLineAnnotations([
        { side: 'additions', lineNumber: 0, metadata: 'new-file' },
      ]);

      const { unifiedContentRows } = await renderer.asyncRender(diff, {
        startingLine: 1,
        totalLines: 5,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      assertDefined(unifiedContentRows, 'unifiedContentRows should be defined');

      expect(
        unifiedContentRows.some((node) => getAnnotationIndex(node) === '-1,-1')
      ).toBe(false);
    });
  });

  describe('line index matching', () => {
    test('annotation lineIndex matches preceding line in unified style', async () => {
      const annotations: DiffLineAnnotation<string>[] = [
        { side: 'additions', lineNumber: 8, metadata: 'new-import' },
        { side: 'additions', lineNumber: 30, metadata: 'changed-line' },
        { side: 'deletions', lineNumber: 25, metadata: 'old-line' },
      ];

      const renderer = new DiffHunksRenderer<string>({
        diffStyle: 'unified',
        expandUnchanged: true,
      });
      renderer.setLineAnnotations(annotations);
      const { unifiedContentRows } = await renderer.asyncRender(diff);
      assertDefined(unifiedContentRows, 'unifiedContentRows should be defined');
      const unifiedAST = unifiedContentRows;

      let foundAnnotationCount = 0;
      let lastLineElement: RenderedRow | undefined;
      // Iterate through all elements and verify each annotation follows its line
      const allElements = collectAllElements(unifiedAST);
      for (const node of allElements) {
        if (isLineRow(node)) {
          lastLineElement = node;
          continue;
        }
        if (!isAnnotationRow(node)) {
          continue;
        }

        const annotationIndex = getAnnotationIndex(node);
        assertDefined(annotationIndex, 'annotationIndex should be defined');
        const [, lineIdx] = annotationIndex.split(',');
        const slots = findSlotElements(node);
        foundAnnotationCount += slots.length;

        assertDefined(lastLineElement, 'lastLineElement should be defined');
        // The previous line element should be the line this annotation belongs to
        const prevLineIndex = getLineIndex(lastLineElement);
        assertDefined(prevLineIndex, 'prevLineIndex should be defined');
        // In unified, the first value of data-line-index is the unified index
        const [unifiedIdx] = prevLineIndex.split(',');
        expect(unifiedIdx).toBe(lineIdx);
      }
      expect(foundAnnotationCount).toBe(annotations.length);
      // Compact placement record: which line each annotation follows and
      // which slots it exposes
      expect(annotationProjection(unifiedAST)).toMatchSnapshot(
        'unified annotation placement'
      );
    });

    test('annotation lineIndex matches preceding line in split style', async () => {
      const annotations: DiffLineAnnotation<string>[] = [
        { side: 'additions', lineNumber: 8, metadata: 'new-import' },
        { side: 'additions', lineNumber: 30, metadata: 'changed-line' },
        { side: 'deletions', lineNumber: 25, metadata: 'old-line' },
      ];
      const totalAdditions = annotations.reduce((count, annotation) => {
        return annotation.side === 'additions' ? count + 1 : count;
      }, 0);
      const totalDeletions = annotations.reduce((count, annotation) => {
        return annotation.side === 'deletions' ? count + 1 : count;
      }, 0);

      const renderer = new DiffHunksRenderer<string>({
        diffStyle: 'split',
        expandUnchanged: true,
      });
      renderer.setLineAnnotations(annotations);
      const { additionsContentRows, deletionsContentRows } =
        await renderer.asyncRender(diff);
      assertDefined(
        additionsContentRows,
        'additionsContentRows should be defined'
      );
      assertDefined(
        deletionsContentRows,
        'deletionsContentRows should be defined'
      );
      const additionsAST = additionsContentRows;
      const deletionsAST = deletionsContentRows;

      const additionsAnnotationIndices = new Set<string>();
      const deletionsAnnotationIndices = new Set<string>();

      for (const ast of [additionsAST, deletionsAST]) {
        const isAdditions = ast === additionsAST;
        const expectedCount = isAdditions ? totalAdditions : totalDeletions;
        const indicesSet = isAdditions
          ? additionsAnnotationIndices
          : deletionsAnnotationIndices;

        let foundCount = 0;
        let lastLineNode: RenderedRow | undefined;
        const allElements = collectAllElements(ast);
        for (const node of allElements) {
          if (isLineRow(node)) {
            lastLineNode = node;
            continue;
          }
          if (!isAnnotationRow(node)) {
            continue;
          }

          const annotationIndex = getAnnotationIndex(node);
          assertDefined(annotationIndex, 'annotationIndex should be defined');
          if (indicesSet.has(annotationIndex)) {
            throw new Error(`Duplicate annotation index: ${annotationIndex}`);
          }
          indicesSet.add(annotationIndex);

          const slots = findSlotElements(node);
          if (slots.length === 0) {
            // Empty annotation wrapper (for sync with other side)
            continue;
          }
          foundCount += slots.length;

          const [, lineIdx] = annotationIndex.split(',');

          assertDefined(lastLineNode, 'lastLineNode should be defined');

          const prevLineIndex = getLineIndex(lastLineNode);
          assertDefined(prevLineIndex, 'prevLineIndex should be defined');
          const [, splitIdx] = prevLineIndex.split(',');
          expect(splitIdx).toBe(lineIdx);
        }
        expect(foundCount).toBe(expectedCount);
      }

      // Verify both sides have matching annotation indices
      for (const idx of additionsAnnotationIndices) {
        expect(deletionsAnnotationIndices.has(idx)).toBe(true);
      }
      expect(additionsAnnotationIndices.size).toBe(
        deletionsAnnotationIndices.size
      );
      expect(annotationProjection(additionsAST)).toMatchSnapshot(
        'split additions annotation placement'
      );
      expect(annotationProjection(deletionsAST)).toMatchSnapshot(
        'split deletions annotation placement'
      );
    });
  });

  describe('annotations in different line types', () => {
    test('annotations on all line types (context, addition, deletion, expanded)', async () => {
      // Line 5 is context, line 8 is addition, line 44 is deletion
      // Line 15 is in collapsed region before Hunk 1, line 600 is in last collapsed region (577-632)
      const expectedTypes: Record<string, LineTypes> = {
        'annotation-additions-5': 'context',
        'annotation-additions-8': 'change-addition',
        'annotation-deletions-44': 'change-deletion',
        'annotation-additions-15': 'context-expanded',
        // Final expanded content region, since that code is rendered through a
        // slightly different code page
        'annotation-additions-600': 'context-expanded',
      };
      const annotations: DiffLineAnnotation<LineTypes>[] = [
        { side: 'additions', lineNumber: 5, metadata: 'context' },
        { side: 'additions', lineNumber: 8, metadata: 'change-addition' },
        { side: 'deletions', lineNumber: 44, metadata: 'change-deletion' },
        { side: 'additions', lineNumber: 15, metadata: 'context-expanded' },
        { side: 'additions', lineNumber: 600, metadata: 'context-expanded' },
      ];

      const renderer = new DiffHunksRenderer<string>({
        diffStyle: 'unified',
        expandUnchanged: true,
      });
      renderer.setLineAnnotations(annotations);
      const { unifiedContentRows } = await renderer.asyncRender(diff);
      assertDefined(unifiedContentRows, 'unifiedContentRows should be defined');
      const unifiedAST = unifiedContentRows;
      expect(countAnnotationRows(unifiedAST)).toBe(annotations.length);

      // Iterate and verify each annotation's preceding line type
      for (let i = 1; i < unifiedAST.length; i++) {
        if (!isAnnotationRow(unifiedAST[i])) continue;
        const slots = findSlotElements(unifiedAST[i] as RenderedLine);
        const slotName = slots[0]?.properties?.name?.toString();
        if (slots.length === 0 || slotName == null) {
          throw new Error('there should always be slots in unifiedAST');
        }
        const prevLineType = getLineType(unifiedAST[i - 1]);
        expect(prevLineType).toBe(expectedTypes[slotName]);
      }
    });

    test('annotations on all line types in split style', async () => {
      // Same line numbers as unified test, but verify in separate ASTs
      // Additions AST: lines 5 (context), 8 (change-addition), 15 (expanded), 600 (expanded)
      // Deletions AST: line 44 (change-deletion)
      const additionsExpectedTypes: Record<string, LineTypes> = {
        'annotation-additions-5': 'context',
        'annotation-additions-8': 'change-addition',
        'annotation-additions-15': 'context-expanded',
        'annotation-additions-600': 'context-expanded',
      };
      const deletionsExpectedTypes: Record<string, LineTypes> = {
        'annotation-deletions-44': 'change-deletion',
      };

      const annotations: DiffLineAnnotation<LineTypes>[] = [
        { side: 'additions', lineNumber: 5, metadata: 'context' },
        { side: 'additions', lineNumber: 8, metadata: 'change-addition' },
        { side: 'deletions', lineNumber: 44, metadata: 'change-deletion' },
        { side: 'additions', lineNumber: 15, metadata: 'context-expanded' },
        { side: 'additions', lineNumber: 600, metadata: 'context-expanded' },
      ];

      const renderer = new DiffHunksRenderer<string>({
        diffStyle: 'split',
        expandUnchanged: true,
      });
      renderer.setLineAnnotations(annotations);
      const { deletionsContentRows, additionsContentRows } =
        await renderer.asyncRender(diff);
      assertDefined(
        additionsContentRows,
        'additionsContentRows should be defined'
      );
      assertDefined(
        deletionsContentRows,
        'deletionsContentRows should be defined'
      );
      const additionsAST = additionsContentRows;
      const deletionsAST = deletionsContentRows;

      // Check additions AST
      let additionsAnnotationCount = 0;
      let lastAdditionLine: RenderedRow | undefined;
      const additionsElements = collectAllElements(additionsAST);
      for (const node of additionsElements) {
        if (isLineRow(node)) {
          lastAdditionLine = node;
          continue;
        }
        if (!isAnnotationRow(node)) continue;
        const slots = findSlotElements(node);
        if (slots.length === 0) continue; // Skip empty annotation wrappers
        const slotName = slots[0].properties?.name?.toString();
        if (slotName == null) {
          throw new Error('slot should have a name');
        }
        additionsAnnotationCount++;
        assertDefined(lastAdditionLine, 'lastAdditionLine should be defined');
        const prevLineType = getLineType(lastAdditionLine);
        expect(prevLineType).toBe(additionsExpectedTypes[slotName]);
      }
      expect(additionsAnnotationCount).toBe(
        Object.keys(additionsExpectedTypes).length
      );

      // Check deletions AST
      let deletionsAnnotationCount = 0;
      let lastDeletionLine: RenderedRow | undefined;
      const deletionsElements = collectAllElements(deletionsAST);
      for (const node of deletionsElements) {
        if (isLineRow(node)) {
          lastDeletionLine = node;
          continue;
        }
        if (!isAnnotationRow(node)) continue;
        const slots = findSlotElements(node);
        if (slots.length === 0) continue; // Skip empty annotation wrappers
        const slotName = slots[0].properties?.name?.toString();
        if (slotName == null) {
          throw new Error('slot should have a name');
        }
        deletionsAnnotationCount++;
        assertDefined(lastDeletionLine, 'lastDeletionLine should be defined');
        const prevLineType = getLineType(lastDeletionLine);
        expect(prevLineType).toBe(deletionsExpectedTypes[slotName]);
      }
      expect(deletionsAnnotationCount).toBe(
        Object.keys(deletionsExpectedTypes).length
      );
    });
  });

  describe('annotation collapsing in unified style', () => {
    test('annotations on both addition and deletion side of same context line collapse into 1 element', async () => {
      const annotations: DiffLineAnnotation<string>[] = [
        {
          side: 'additions',
          lineNumber: 5,
          metadata: 'annotation-from-additions',
        },
        {
          side: 'deletions',
          lineNumber: 5,
          metadata: 'annotation-from-deletions',
        },
      ];

      const renderer = new DiffHunksRenderer<string>({ diffStyle: 'unified' });
      renderer.setLineAnnotations(annotations);
      const { unifiedContentRows } = await renderer.asyncRender(diff);
      assertDefined(unifiedContentRows, 'unifiedContentRows should be defined');
      const unifiedAST = unifiedContentRows;

      // Should only have 1 annotation element
      expect(countAnnotationRows(unifiedAST)).toBe(1);

      // Find the annotation and verify it has 2 slots
      const allElements = collectAllElements(unifiedAST);
      const annotationEl = allElements.find(isAnnotationRow);
      assertDefined(annotationEl, 'annotationEl should be defined');

      const slots = findSlotElements(annotationEl);
      expect(slots.length).toBe(2);

      const slotNames = slots.map((s) => s.properties?.name);
      expect(slotNames).toContain('annotation-additions-5');
      expect(slotNames).toContain('annotation-deletions-5');
    });

    test('in split style, annotations on both sides remain separate', async () => {
      const annotations: DiffLineAnnotation<string>[] = [
        {
          side: 'additions',
          lineNumber: 5,
          metadata: 'some-metadata',
        },
        {
          side: 'deletions',
          lineNumber: 5,
          metadata: 'some-metadata',
        },
      ];

      const renderer = new DiffHunksRenderer<string>({ diffStyle: 'split' });
      renderer.setLineAnnotations(annotations);
      const { additionsContentRows, deletionsContentRows } =
        await renderer.asyncRender(diff);
      assertDefined(
        additionsContentRows,
        'additionsContentRows should be defined'
      );
      assertDefined(
        deletionsContentRows,
        'deletionsContentRows should be defined'
      );
      const additionsAST = additionsContentRows;
      const deletionsAST = deletionsContentRows;

      // Each side should have 1 annotation
      expect(countAnnotationRows(additionsAST)).toBe(1);
      expect(countAnnotationRows(deletionsAST)).toBe(1);

      // Find annotations and verify each has 1 slot
      const additionsElements = collectAllElements(additionsAST);
      const deletionsElements = collectAllElements(deletionsAST);
      const additionAnnotation = additionsElements.find(isAnnotationRow);
      const deletionAnnotation = deletionsElements.find(isAnnotationRow);
      assertDefined(additionAnnotation, 'additionAnnotation should be defined');
      assertDefined(deletionAnnotation, 'deletionAnnotation should be defined');

      const additionSlots = findSlotElements(additionAnnotation);
      const deletionSlots = findSlotElements(deletionAnnotation);

      expect(additionSlots.length).toBe(1);
      expect(deletionSlots.length).toBe(1);
      expect(additionSlots[0].properties?.name).toBe('annotation-additions-5');
      expect(deletionSlots[0].properties?.name).toBe('annotation-deletions-5');
    });
  });
});
