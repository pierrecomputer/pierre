import type { ElementContent, Element as HASTElement } from 'hast';

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

  let expectedSplitLineStart = 0;
  let expectedUnifiedLineStart = 0;
  let lastHunkAdditionEnd = 0;

  for (const [hunkIndex, hunk] of file.hunks.entries()) {
    const hunkPrefix = `${prefix}.hunks[${hunkIndex}]`;

    // Count lines from hunkContent
    let contextLines = 0;
    let additionLines = 0;
    let deletionLines = 0;

    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        contextLines += content.lines.length;
      } else if (content.type === 'change') {
        additionLines += content.additions.length;
        deletionLines += content.deletions.length;
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

    // Verify splitLineCount = max(additionCount, deletionCount)
    const expectedSplitLineCount = Math.max(
      hunk.additionCount,
      hunk.deletionCount
    );
    if (hunk.splitLineCount !== expectedSplitLineCount) {
      errors.push(
        `${hunkPrefix}: splitLineCount (${hunk.splitLineCount}) !== max(additionCount, deletionCount) (${expectedSplitLineCount})`
      );
    }

    // Verify splitLineStart is cumulative
    if (hunk.splitLineStart !== expectedSplitLineStart) {
      errors.push(
        `${hunkPrefix}: splitLineStart (${hunk.splitLineStart}) !== expected cumulative (${expectedSplitLineStart})`
      );
    }
    expectedSplitLineStart += hunk.splitLineCount;

    // Verify unifiedLineStart is cumulative
    if (hunk.unifiedLineStart !== expectedUnifiedLineStart) {
      errors.push(
        `${hunkPrefix}: unifiedLineStart (${hunk.unifiedLineStart}) !== expected cumulative (${expectedUnifiedLineStart})`
      );
    }
    expectedUnifiedLineStart += hunk.unifiedLineCount;

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
  const expectedTotalSplitLines = file.hunks.reduce(
    (sum, h) => sum + h.splitLineCount,
    0
  );
  if (file.splitLineCount !== expectedTotalSplitLines) {
    errors.push(
      `${prefix}: splitLineCount (${file.splitLineCount}) !== sum of hunk splitLineCounts (${expectedTotalSplitLines})`
    );
  }

  const expectedTotalUnifiedLines = file.hunks.reduce(
    (sum, h) => sum + h.unifiedLineCount,
    0
  );
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
