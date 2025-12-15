import { describe, expect, test } from 'bun:test';
import type { ElementContent, Element as HASTElement } from 'hast';

import { DiffHunksRenderer, parseDiffFromFile } from '../src';
import type { DiffLineAnnotation, LineTypes } from '../src/types';
import { fileNew, fileOld } from './mocks';
import {
  countHastAnnotationElements,
  findHastSlotElements,
  getHastAnnotationIndex,
  getHastLineIndex,
  getHastLineType,
  isHastAnnotationElement,
  isHastElement,
  isHastLineElement,
} from './testUtils';

const oldFile = { name: 'DiffRenderer.ts', contents: fileOld };
const newFile = { name: 'DiffRenderer.ts', contents: fileNew };

describe('Annotation Rendering', () => {
  const diff = parseDiffFromFile(oldFile, newFile);

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
      const result = await renderer.asyncRender(diff);

      if (result.unifiedAST == null) {
        throw new Error('unifiedAST does not exist on result');
      }

      let foundAnnotationCount = 0;
      let lastElement: ElementContent | undefined;
      // Iterate through flat array and verify each annotation follows its line
      for (const node of result.unifiedAST) {
        if (!isHastAnnotationElement(node) || !isHastElement(node)) {
          lastElement = node;
          continue;
        }

        const annotationIndex = getHastAnnotationIndex(node);
        expect(annotationIndex).toBeDefined();
        const [, lineIdx] = annotationIndex!.split(',');
        const slots = findHastSlotElements(node);
        foundAnnotationCount += slots.length;

        if (lastElement == null) {
          throw new Error('lastElement should not be undefined');
        }
        // The previous element should be the line this annotation belongs to
        expect(isHastLineElement(lastElement)).toBe(true);
        const prevLineIndex = getHastLineIndex(lastElement);
        expect(prevLineIndex).toBeDefined();
        // In unified, the first value of data-line-index is the unified index
        const [unifiedIdx] = prevLineIndex!.split(',');
        expect(unifiedIdx).toBe(lineIdx);
        lastElement = node;
      }
      expect(foundAnnotationCount).toBe(annotations.length);
      expect(result.unifiedAST).toMatchSnapshot('unified with annotations');
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
      const result = await renderer.asyncRender(diff);

      expect(result.additionsAST).toBeDefined();
      expect(result.deletionsAST).toBeDefined();
      if (result.additionsAST == null || result.deletionsAST == null) {
        throw new Error('additionsAST or deletionsAST is undefined');
      }

      const additionsAnnotationIndices = new Set<string>();
      const deletionsAnnotationIndices = new Set<string>();

      for (const ast of [result.additionsAST, result.deletionsAST]) {
        const isAdditions = ast === result.additionsAST;
        const expectedCount = isAdditions ? totalAdditions : totalDeletions;
        const indicesSet = isAdditions
          ? additionsAnnotationIndices
          : deletionsAnnotationIndices;

        let foundCount = 0;
        let lastNode: ElementContent | undefined;
        for (const node of ast) {
          if (!isHastAnnotationElement(node) || !isHastElement(node)) {
            lastNode = node;
            continue;
          }

          const annotationIndex = getHastAnnotationIndex(node);
          expect(annotationIndex).toBeDefined();
          if (annotationIndex == null) {
            throw new Error('annotationIndex is not defined on node');
          }
          if (indicesSet.has(annotationIndex)) {
            throw new Error(`Duplicate annotation index: ${annotationIndex}`);
          }
          indicesSet.add(annotationIndex);

          const slots = findHastSlotElements(node);
          if (slots.length === 0) {
            // Empty annotation wrapper (for sync with other side)
            lastNode = node;
            continue;
          }
          foundCount += slots.length;

          const [, lineIdx] = annotationIndex.split(',');

          if (lastNode == null) {
            throw new Error('lastNode is undefined');
          }
          expect(isHastLineElement(lastNode)).toBe(true);

          const prevLineIndex = getHastLineIndex(lastNode);
          if (prevLineIndex == null) {
            throw new Error('lastNode has no line index');
          }
          const [, splitIdx] = prevLineIndex.split(',');
          expect(splitIdx).toBe(lineIdx);
          lastNode = node;
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
      expect(result.additionsAST).toMatchSnapshot(
        'split additions with annotations'
      );
      expect(result.deletionsAST).toMatchSnapshot(
        'split deletions with annotations'
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
        // Final expanded content region, since that code is rendered a bit
        // diff
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
      const result = await renderer.asyncRender(diff);

      const { unifiedAST } = result;
      expect(unifiedAST).toBeDefined();
      if (unifiedAST == null) {
        throw new Error('No unified AST rendered');
      }
      expect(countHastAnnotationElements(unifiedAST)).toBe(annotations.length);

      // Iterate and verify each annotation's preceding line type
      for (let i = 1; i < unifiedAST.length; i++) {
        if (
          !isHastAnnotationElement(unifiedAST[i]) ||
          !isHastElement(unifiedAST[i])
        )
          continue;
        const slots = findHastSlotElements(unifiedAST[i] as HASTElement);
        const slotName = slots[0].properties?.name?.toString();
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
      const result = await renderer.asyncRender(diff);

      expect(result.additionsAST).toBeDefined();
      expect(result.deletionsAST).toBeDefined();
      if (result.additionsAST == null || result.deletionsAST == null) {
        throw new Error('additionsAST or deletionsAST is undefined');
      }

      // Check additions AST
      let additionsAnnotationCount = 0;
      for (let i = 1; i < result.additionsAST.length; i++) {
        const node = result.additionsAST[i];
        if (!isHastAnnotationElement(node) || !isHastElement(node)) continue;
        const slots = findHastSlotElements(node);
        if (slots.length === 0) continue; // Skip empty annotation wrappers
        const slotName = slots[0].properties?.name?.toString();
        if (slotName == null) {
          throw new Error('slot should have a name');
        }
        additionsAnnotationCount++;
        const prevLineType = getHastLineType(result.additionsAST[i - 1]);
        expect(prevLineType).toBe(additionsExpectedTypes[slotName]);
      }
      expect(additionsAnnotationCount).toBe(
        Object.keys(additionsExpectedTypes).length
      );

      // Check deletions AST
      let deletionsAnnotationCount = 0;
      for (let i = 1; i < result.deletionsAST.length; i++) {
        const node = result.deletionsAST[i];
        if (!isHastAnnotationElement(node) || !isHastElement(node)) continue;
        const slots = findHastSlotElements(node);
        if (slots.length === 0) continue; // Skip empty annotation wrappers
        const slotName = slots[0].properties?.name?.toString();
        if (slotName == null) {
          throw new Error('slot should have a name');
        }
        deletionsAnnotationCount++;
        const prevLineType = getHastLineType(result.deletionsAST[i - 1]);
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
      const result = await renderer.asyncRender(diff);

      const { unifiedAST } = result;
      expect(unifiedAST).toBeDefined();
      if (unifiedAST == null) {
        throw new Error('unifiedAST must be defined');
      }

      // Should only have 1 annotation element
      expect(countHastAnnotationElements(unifiedAST)).toBe(1);

      // Find the annotation and verify it has 2 slots
      const annotationEl = unifiedAST.find(isHastAnnotationElement);
      expect(annotationEl).toBeDefined();
      if (annotationEl == null) {
        throw new Error('annotationEl must be defined');
      }
      expect(isHastElement(annotationEl)).toBe(true);

      const slots = findHastSlotElements(annotationEl as HASTElement);
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
      const result = await renderer.asyncRender(diff);

      expect(result.additionsAST).toBeDefined();
      expect(result.deletionsAST).toBeDefined();

      // Each side should have 1 annotation
      expect(countHastAnnotationElements(result.additionsAST!)).toBe(1);
      expect(countHastAnnotationElements(result.deletionsAST!)).toBe(1);

      // Find annotations and verify each has 1 slot
      const additionAnnotation = result.additionsAST!.find(
        isHastAnnotationElement
      );
      const deletionAnnotation = result.deletionsAST!.find(
        isHastAnnotationElement
      );

      expect(additionAnnotation).toBeDefined();
      expect(deletionAnnotation).toBeDefined();

      const additionSlots = findHastSlotElements(
        additionAnnotation as HASTElement
      );
      const deletionSlots = findHastSlotElements(
        deletionAnnotation as HASTElement
      );

      expect(additionSlots.length).toBe(1);
      expect(deletionSlots.length).toBe(1);
      expect(additionSlots[0].properties?.name).toBe('annotation-additions-5');
      expect(deletionSlots[0].properties?.name).toBe('annotation-deletions-5');
    });
  });
});
