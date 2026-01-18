import type { ElementContent, Element as HASTElement } from 'hast';

import type { HunksRenderResult } from '../src/renderers/DiffHunksRenderer';
import type { FileDiffMetadata, ParsedPatch } from '../src/types';

// Assertion helpers

export function assertDefined<T>(
  value: T | undefined | null,
  message: string
): asserts value is T {
  if (value == null) {
    throw new Error(message);
  }
}

// HAST element helpers

export function isHastElement(node: ElementContent): node is HASTElement {
  return node.type === 'element';
}

export function isHastLineElement(node: ElementContent): boolean {
  return isHastElement(node) && node.properties?.['data-line'] != null;
}

export function isHastAnnotationElement(node: ElementContent): boolean {
  return (
    isHastElement(node) && node.properties?.['data-line-annotation'] != null
  );
}

export function getHastLineIndex(node: ElementContent): string | undefined {
  if (!isHastElement(node)) return undefined;
  const lineIndex = node.properties?.['data-line-index'];
  return typeof lineIndex === 'string' ? lineIndex : undefined;
}

export function getHastAnnotationIndex(
  node: ElementContent
): string | undefined {
  if (!isHastElement(node)) return undefined;
  const lineAnnotation = node.properties?.['data-line-annotation'];
  return typeof lineAnnotation === 'string' ? lineAnnotation : undefined;
}

export function getHastLineType(node: ElementContent): string | undefined {
  if (!isHastElement(node)) return undefined;
  const lineType = node.properties?.['data-line-type'];
  return typeof lineType === 'string' ? lineType : undefined;
}

export function findHastSlotElements(el: HASTElement): HASTElement[] {
  const slots: HASTElement[] = [];
  for (const child of el.children) {
    if (isHastElement(child)) {
      if (child.tagName === 'slot') {
        slots.push(child);
      }
      slots.push(...findHastSlotElements(child));
    }
  }
  return slots;
}

export function countHastAnnotationElements(ast: ElementContent[]): number {
  return ast.filter(isHastAnnotationElement).length;
}

export interface VerifyResult {
  valid: boolean;
  errors: string[];
}

export function verifyHunkLineValues(
  file: FileDiffMetadata,
  prefix: string = 'file'
): string[] {
  const errors: string[] = [];

  let currentSplitLineTotal = 0;
  let currentUnifiedLineTotal = 0;
  let lastHunkAdditionEnd = 0;

  for (const [hunkIndex, hunk] of file.hunks.entries()) {
    const hunkPrefix = `${prefix}.hunks[${hunkIndex}]`;

    // Count lines from hunkContent
    let contextLines = 0;
    let additionLines = 0;
    let deletionLines = 0;

    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        contextLines += content.lines;
      } else if (content.type === 'change') {
        additionLines += content.additions;
        deletionLines += content.deletions;
      }
    }

    // Verify additionCount = additionLines + contextLines
    const expectedAdditionCount = additionLines + contextLines;
    if (hunk.additionCount !== expectedAdditionCount) {
      errors.push(
        `${hunkPrefix}: additionCount (${hunk.additionCount}) !== additionLines + context (${expectedAdditionCount})`
      );
    }

    // Verify deletionCount = deletionLines + contextLines
    const expectedDeletionCount = deletionLines + contextLines;
    if (hunk.deletionCount !== expectedDeletionCount) {
      errors.push(
        `${hunkPrefix}: deletionCount (${hunk.deletionCount}) !== deletionLines + context (${expectedDeletionCount})`
      );
    }

    // Verify additionLines matches counted
    if (hunk.additionLines !== additionLines) {
      errors.push(
        `${hunkPrefix}: additionLines (${hunk.additionLines}) !== counted additions (${additionLines})`
      );
    }

    // Verify deletionLines matches counted
    if (hunk.deletionLines !== deletionLines) {
      errors.push(
        `${hunkPrefix}: deletionLines (${hunk.deletionLines}) !== counted deletions (${deletionLines})`
      );
    }

    // Verify splitLineCount = sum of (context lines + max(additions, deletions) per change block)
    const expectedSplitLineCount = hunk.hunkContent.reduce((acc, content) => {
      if (content.type === 'context') {
        return acc + content.lines;
      }
      return acc + Math.max(content.additions, content.deletions);
    }, 0);
    if (hunk.splitLineCount !== expectedSplitLineCount) {
      errors.push(
        `${hunkPrefix}: splitLineCount (${hunk.splitLineCount}) !== calculated from hunkContent (${expectedSplitLineCount})`
      );
    }

    // Verify unifiedLineCount = sum of (context lines + additions + deletions per change block)
    const expectedUnifiedLineCount = hunk.hunkContent.reduce((acc, content) => {
      if (content.type === 'context') {
        return acc + content.lines;
      }
      return acc + content.additions + content.deletions;
    }, 0);
    if (hunk.unifiedLineCount !== expectedUnifiedLineCount) {
      errors.push(
        `${hunkPrefix}: unifiedLineCount (${hunk.unifiedLineCount}) !== calculated from hunkContent (${expectedUnifiedLineCount})`
      );
    }

    const expectedSplitLineStart = currentSplitLineTotal + hunk.collapsedBefore;
    // Verify splitLineStart is cumulative
    if (hunk.splitLineStart !== expectedSplitLineStart) {
      errors.push(
        `${hunkPrefix}: splitLineStart (${hunk.splitLineStart}) !== expected cumulative (${expectedSplitLineStart})`
      );
    }
    currentSplitLineTotal += hunk.collapsedBefore + hunk.splitLineCount;

    const expectedUnifiedLineStart =
      currentUnifiedLineTotal + hunk.collapsedBefore;
    // Verify unifiedLineStart is cumulative
    if (hunk.unifiedLineStart !== expectedUnifiedLineStart) {
      errors.push(
        `${hunkPrefix}: unifiedLineStart (${hunk.unifiedLineStart}) !== expected cumulative (${expectedUnifiedLineStart})`
      );
    }
    currentUnifiedLineTotal += hunk.collapsedBefore + hunk.unifiedLineCount;

    // Verify collapsedBefore = additionStart - 1 - lastHunkAdditionEnd
    const expectedCollapsedBefore = Math.max(
      hunk.additionStart - 1 - lastHunkAdditionEnd,
      0
    );
    if (hunk.collapsedBefore !== expectedCollapsedBefore) {
      errors.push(
        `${hunkPrefix}: collapsedBefore (${hunk.collapsedBefore}) !== expected (${expectedCollapsedBefore})`
      );
    }
    lastHunkAdditionEnd = hunk.additionStart + hunk.additionCount - 1;
  }

  // Verify file-level totals
  let expectedTotalSplitLines = file.hunks.reduce(
    (sum, h) => sum + h.collapsedBefore + h.splitLineCount,
    0
  );
  let expectedTotalUnifiedLines = file.hunks.reduce(
    (sum, h) => sum + h.collapsedBefore + h.unifiedLineCount,
    0
  );

  // Account for collapsed lines after the final hunk (only for non-partial diffs)
  if (file.hunks.length > 0 && !file.isPartial) {
    const lastHunk = file.hunks[file.hunks.length - 1];
    const lastHunkEnd = lastHunk.additionStart + lastHunk.additionCount - 1;
    const totalFileLines = file.additionLines.length;
    const collapsedAfter = Math.max(totalFileLines - lastHunkEnd, 0);

    expectedTotalSplitLines += collapsedAfter;
    expectedTotalUnifiedLines += collapsedAfter;
  }

  if (file.splitLineCount !== expectedTotalSplitLines) {
    errors.push(
      `${prefix}: splitLineCount (${file.splitLineCount}) !== sum of hunk splitLineCounts (${expectedTotalSplitLines})`
    );
  }

  if (file.unifiedLineCount !== expectedTotalUnifiedLines) {
    errors.push(
      `${prefix}: unifiedLineCount (${file.unifiedLineCount}) !== sum of hunk unifiedLineCounts (${expectedTotalUnifiedLines})`
    );
  }

  return errors;
}

export function verifyPatchHunkValues(patches: ParsedPatch[]): VerifyResult {
  const errors: string[] = [];

  for (const [patchIndex, patch] of patches.entries()) {
    for (const [fileIndex, file] of patch.files.entries()) {
      const prefix = `patch[${patchIndex}].files[${fileIndex}] (${file.name})`;
      errors.push(...verifyHunkLineValues(file, prefix));
    }
  }

  return { valid: errors.length === 0, errors };
}

export function verifyFileDiffHunkValues(diff: FileDiffMetadata): VerifyResult {
  const errors = verifyHunkLineValues(diff);
  return { valid: errors.length === 0, errors };
}

export function countRenderedLines(ast: ElementContent[]): number {
  return ast.filter(
    (node) => isHastElement(node) && node.properties?.['data-line'] != null
  ).length;
}

// Count rows in split mode by looking at line-index values
// Each unique line-index represents one visual row in split view
export function countSplitRows(result: HunksRenderResult): number {
  const lineIndices = new Set<number>();
  const additionsAST = result.additionsAST ?? [];
  const deletionsAST = result.deletionsAST ?? [];

  for (const nodes of [additionsAST, deletionsAST]) {
    for (const node of nodes) {
      if (isHastElement(node)) {
        const lineIndex = node.properties?.['data-line-index'];
        if (typeof lineIndex === 'string') {
          // data-line-index format is "unifiedIndex,splitIndex"
          const splitIndex = Number.parseInt(lineIndex.split(',')[1], 10);
          if (!isNaN(splitIndex)) {
            lineIndices.add(splitIndex);
          }
        }
      }
    }
  }
  return lineIndices.size;
}

// Virtualization buffer helpers

export interface BufferElement {
  position: 'before' | 'after';
  height: number;
}

export function findBufferElements(ast: ElementContent[]): BufferElement[] {
  const buffers: BufferElement[] = [];

  for (const node of ast) {
    if (isHastElement(node)) {
      const position = node.properties?.['data-virtualized-buffer'];
      if (position === 'before' || position === 'after') {
        const style = node.properties?.['style'];
        const heightMatch =
          typeof style === 'string' ? style.match(/height:\s*(\d+)px/) : null;
        const height =
          heightMatch != null ? Number.parseInt(heightMatch[1], 10) : 0;
        buffers.push({ position, height });
      }
    }
  }

  return buffers;
}

export function extractLineNumbers(ast: ElementContent[]): {
  unifiedIndices: number[];
  splitIndices: number[];
} {
  const unifiedIndices: number[] = [];
  const splitIndices: number[] = [];

  for (const node of ast) {
    if (isHastElement(node) && node.properties?.['data-line'] != null) {
      const lineIndex = node.properties?.['data-line-index'];
      if (typeof lineIndex === 'string') {
        // data-line-index format is "unifiedIndex,splitIndex"
        const [unifiedStr, splitStr] = lineIndex.split(',');
        const unified = Number.parseInt(unifiedStr, 10);
        const split = Number.parseInt(splitStr, 10);
        if (!isNaN(unified)) {
          unifiedIndices.push(unified);
        }
        if (!isNaN(split)) {
          splitIndices.push(split);
        }
      }
    }
  }

  return { unifiedIndices, splitIndices };
}
