import { afterAll, describe, expect, test } from 'bun:test';
import type { ElementContent, Element as HASTElement } from 'hast';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  parseDiffFromFile,
} from '../src';
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  LineTypes,
} from '../src/types';
import { EMPTY_DIFF_LINES } from '../src/utils/diffLines';
import { fileNew, fileOld } from './mocks';
import {
  annotationProjection,
  assertDefined,
  collectAllElements,
  countHastAnnotationElements,
  findHastSlotElements,
  getHastAnnotationIndex,
  getHastLineIndex,
  getHastLineType,
  isHastAnnotationElement,
  isHastElement,
  isHastLineElement,
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
    deletionLines: EMPTY_DIFF_LINES,
    additionLines: EMPTY_DIFF_LINES,
  };
}

function getSlotNames(node: ElementContent): string[] {
  if (!isHastElement(node)) {
    return [];
  }
  return findHastSlotElements(node).map((slot) => {
    const name = slot.properties?.name;
    if (name == null) {
      throw new Error('slot should have a name');
    }
    return name.toString();
  });
}

function getAnnotationIndexes(nodes: ElementContent[]): string[] {
  return nodes
    .map((node) => getHastAnnotationIndex(node))
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

      const { unifiedContentAST } = await renderer.asyncRender(
        createDiffWithLeadingSeparator()
      );
      assertDefined(unifiedContentAST, 'unifiedContentAST should be defined');
      const firstAnnotationIndex = unifiedContentAST.findIndex(
        isHastAnnotationElement
      );
      const firstSeparatorIndex = unifiedContentAST.findIndex(
        (node) =>
          isHastElement(node) && node.properties?.['data-separator'] != null
      );
      const firstAnnotation = unifiedContentAST[firstAnnotationIndex];
      assertDefined(firstAnnotation, 'firstAnnotation should be defined');

      expect(firstAnnotationIndex).toBe(0);
      expect(firstSeparatorIndex).toBeGreaterThan(firstAnnotationIndex);
      expect(getHastAnnotationIndex(firstAnnotation)).toBe('-1,-1');
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

        const { additionsContentAST, deletionsContentAST } =
          await renderer.asyncRender(diff);
        assertDefined(
          additionsContentAST,
          'additionsContentAST should be defined'
        );
        assertDefined(
          deletionsContentAST,
          'deletionsContentAST should be defined'
        );
        const firstAddition = additionsContentAST[0];
        const firstDeletion = deletionsContentAST[0];
        assertDefined(firstAddition, 'firstAddition should be defined');
        assertDefined(firstDeletion, 'firstDeletion should be defined');

        expect(getHastAnnotationIndex(firstAddition)).toBe('-1,-1');
        expect(getHastAnnotationIndex(firstDeletion)).toBe('-1,-1');
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

      const { additionsContentAST, deletionsContentAST } =
        await renderer.asyncRender(
          parseDiffFromFile(
            { name: 'first-row.ts', contents: 'old\n' },
            { name: 'first-row.ts', contents: 'new\n' }
          )
        );
      assertDefined(
        additionsContentAST,
        'additionsContentAST should be defined'
      );
      assertDefined(
        deletionsContentAST,
        'deletionsContentAST should be defined'
      );

      const annotationIndexes = getAnnotationIndexes(
        deletionsContentAST
      ).concat(getAnnotationIndexes(additionsContentAST));

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

      const { additionsContentAST, deletionsContentAST, rowCount } =
        await renderer.asyncRender(createNoHunkDiff());
      assertDefined(
        additionsContentAST,
        'additionsContentAST should be defined'
      );
      assertDefined(
        deletionsContentAST,
        'deletionsContentAST should be defined'
      );
      const additionAnnotation = additionsContentAST[0];
      const deletionAnnotation = deletionsContentAST[0];
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

      const { unifiedContentAST } = await renderer.asyncRender(diff, {
        startingLine: 1,
        totalLines: 5,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      assertDefined(unifiedContentAST, 'unifiedContentAST should be defined');

      expect(
        unifiedContentAST.some(
          (node) => getHastAnnotationIndex(node) === '-1,-1'
        )
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
      const { unifiedContentAST } = await renderer.asyncRender(diff);
      assertDefined(unifiedContentAST, 'unifiedContentAST should be defined');
      const unifiedAST = unifiedContentAST;

      let foundAnnotationCount = 0;
      let lastLineElement: ElementContent | undefined;
      // Iterate through all elements and verify each annotation follows its line
      const allElements = collectAllElements(unifiedAST);
      for (const node of allElements) {
        if (isHastLineElement(node)) {
          lastLineElement = node;
          continue;
        }
        if (!isHastAnnotationElement(node)) {
          continue;
        }

        const annotationIndex = getHastAnnotationIndex(node);
        assertDefined(annotationIndex, 'annotationIndex should be defined');
        const [, lineIdx] = annotationIndex.split(',');
        const slots = findHastSlotElements(node);
        foundAnnotationCount += slots.length;

        assertDefined(lastLineElement, 'lastLineElement should be defined');
        // The previous line element should be the line this annotation belongs to
        const prevLineIndex = getHastLineIndex(lastLineElement);
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
      const { additionsContentAST, deletionsContentAST } =
        await renderer.asyncRender(diff);
      assertDefined(
        additionsContentAST,
        'additionsContentAST should be defined'
      );
      assertDefined(
        deletionsContentAST,
        'deletionsContentAST should be defined'
      );
      const additionsAST = additionsContentAST;
      const deletionsAST = deletionsContentAST;

      const additionsAnnotationIndices = new Set<string>();
      const deletionsAnnotationIndices = new Set<string>();

      for (const ast of [additionsAST, deletionsAST]) {
        const isAdditions = ast === additionsAST;
        const expectedCount = isAdditions ? totalAdditions : totalDeletions;
        const indicesSet = isAdditions
          ? additionsAnnotationIndices
          : deletionsAnnotationIndices;

        let foundCount = 0;
        let lastLineNode: ElementContent | undefined;
        const allElements = collectAllElements(ast);
        for (const node of allElements) {
          if (isHastLineElement(node)) {
            lastLineNode = node;
            continue;
          }
          if (!isHastAnnotationElement(node)) {
            continue;
          }

          const annotationIndex = getHastAnnotationIndex(node);
          assertDefined(annotationIndex, 'annotationIndex should be defined');
          if (indicesSet.has(annotationIndex)) {
            throw new Error(`Duplicate annotation index: ${annotationIndex}`);
          }
          indicesSet.add(annotationIndex);

          const slots = findHastSlotElements(node);
          if (slots.length === 0) {
            // Empty annotation wrapper (for sync with other side)
            continue;
          }
          foundCount += slots.length;

          const [, lineIdx] = annotationIndex.split(',');

          assertDefined(lastLineNode, 'lastLineNode should be defined');

          const prevLineIndex = getHastLineIndex(lastLineNode);
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
      const { unifiedContentAST } = await renderer.asyncRender(diff);
      assertDefined(unifiedContentAST, 'unifiedContentAST should be defined');
      const unifiedAST = unifiedContentAST;
      expect(countHastAnnotationElements(unifiedAST)).toBe(annotations.length);

      // Iterate and verify each annotation's preceding line type
      for (let i = 1; i < unifiedAST.length; i++) {
        if (
          !isHastAnnotationElement(unifiedAST[i]) ||
          !isHastElement(unifiedAST[i])
        )
          continue;
        const slots = findHastSlotElements(unifiedAST[i] as HASTElement);
        const slotName = slots[0]?.properties?.name?.toString();
        if (slots.length === 0 || slotName == null) {
          throw new Error('there should always be slots in unifiedAST');
        }
        const prevLineType = getHastLineType(unifiedAST[i - 1]);
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
      const { deletionsContentAST, additionsContentAST } =
        await renderer.asyncRender(diff);
      assertDefined(
        additionsContentAST,
        'additionsContentAST should be defined'
      );
      assertDefined(
        deletionsContentAST,
        'deletionsContentAST should be defined'
      );
      const additionsAST = additionsContentAST;
      const deletionsAST = deletionsContentAST;

      // Check additions AST
      let additionsAnnotationCount = 0;
      let lastAdditionLine: ElementContent | undefined;
      const additionsElements = collectAllElements(additionsAST);
      for (const node of additionsElements) {
        if (isHastLineElement(node)) {
          lastAdditionLine = node;
          continue;
        }
        if (!isHastAnnotationElement(node)) continue;
        const slots = findHastSlotElements(node);
        if (slots.length === 0) continue; // Skip empty annotation wrappers
        const slotName = slots[0].properties?.name?.toString();
        if (slotName == null) {
          throw new Error('slot should have a name');
        }
        additionsAnnotationCount++;
        assertDefined(lastAdditionLine, 'lastAdditionLine should be defined');
        const prevLineType = getHastLineType(lastAdditionLine);
        expect(prevLineType).toBe(additionsExpectedTypes[slotName]);
      }
      expect(additionsAnnotationCount).toBe(
        Object.keys(additionsExpectedTypes).length
      );

      // Check deletions AST
      let deletionsAnnotationCount = 0;
      let lastDeletionLine: ElementContent | undefined;
      const deletionsElements = collectAllElements(deletionsAST);
      for (const node of deletionsElements) {
        if (isHastLineElement(node)) {
          lastDeletionLine = node;
          continue;
        }
        if (!isHastAnnotationElement(node)) continue;
        const slots = findHastSlotElements(node);
        if (slots.length === 0) continue; // Skip empty annotation wrappers
        const slotName = slots[0].properties?.name?.toString();
        if (slotName == null) {
          throw new Error('slot should have a name');
        }
        deletionsAnnotationCount++;
        assertDefined(lastDeletionLine, 'lastDeletionLine should be defined');
        const prevLineType = getHastLineType(lastDeletionLine);
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
      const { unifiedContentAST } = await renderer.asyncRender(diff);
      assertDefined(unifiedContentAST, 'unifiedContentAST should be defined');
      const unifiedAST = unifiedContentAST;

      // Should only have 1 annotation element
      expect(countHastAnnotationElements(unifiedAST)).toBe(1);

      // Find the annotation and verify it has 2 slots
      const allElements = collectAllElements(unifiedAST);
      const annotationEl = allElements.find(isHastAnnotationElement);
      assertDefined(annotationEl, 'annotationEl should be defined');

      const slots = findHastSlotElements(annotationEl);
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
      const { additionsContentAST, deletionsContentAST } =
        await renderer.asyncRender(diff);
      assertDefined(
        additionsContentAST,
        'additionsContentAST should be defined'
      );
      assertDefined(
        deletionsContentAST,
        'deletionsContentAST should be defined'
      );
      const additionsAST = additionsContentAST;
      const deletionsAST = deletionsContentAST;

      // Each side should have 1 annotation
      expect(countHastAnnotationElements(additionsAST)).toBe(1);
      expect(countHastAnnotationElements(deletionsAST)).toBe(1);

      // Find annotations and verify each has 1 slot
      const additionsElements = collectAllElements(additionsAST);
      const deletionsElements = collectAllElements(deletionsAST);
      const additionAnnotation = additionsElements.find(
        isHastAnnotationElement
      );
      const deletionAnnotation = deletionsElements.find(
        isHastAnnotationElement
      );
      assertDefined(additionAnnotation, 'additionAnnotation should be defined');
      assertDefined(deletionAnnotation, 'deletionAnnotation should be defined');

      const additionSlots = findHastSlotElements(additionAnnotation);
      const deletionSlots = findHastSlotElements(deletionAnnotation);

      expect(additionSlots.length).toBe(1);
      expect(deletionSlots.length).toBe(1);
      expect(additionSlots[0].properties?.name).toBe('annotation-additions-5');
      expect(deletionSlots[0].properties?.name).toBe('annotation-deletions-5');
    });
  });
});
