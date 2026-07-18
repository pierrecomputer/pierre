import type { ElementContent, Element as HASTElement } from 'hast';

import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../src/constants';
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

// Helper to recursively collect all elements from AST
export function collectAllElements(nodes: ElementContent[]): HASTElement[] {
  const elements: HASTElement[] = [];
  for (const node of nodes) {
    if (isHastElement(node)) {
      elements.push(node);
      elements.push(...collectAllElements(node.children));
    }
  }
  return elements;
}

export function countHastAnnotationElements(ast: ElementContent[]): number {
  return collectAllElements(ast).filter(isHastAnnotationElement).length;
}

export interface VerifyResult {
  valid: boolean;
  errors: string[];
}

// Checks the cross-field consistency invariants of parsed hunk metadata: the
// per-hunk counts (additionCount, splitLineCount, unifiedLineCount, ...) must
// agree with what the hunkContent blocks declare, and the cumulative
// line-start/collapsedBefore bookkeeping must chain correctly across hunks.
// This intentionally looks like a second implementation of the parser's
// arithmetic — it validates that independently-written fields stay in sync,
// not that the parser matches itself.
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

    // A zero-count range starts after additionStart instead of on it.
    const expectedCollapsedBefore = Math.max(
      hunk.additionStart -
        (hunk.additionCount === 0 ? 0 : 1) -
        lastHunkAdditionEnd,
      0
    );
    if (hunk.collapsedBefore !== expectedCollapsedBefore) {
      errors.push(
        `${hunkPrefix}: collapsedBefore (${hunk.collapsedBefore}) !== expected (${expectedCollapsedBefore})`
      );
    }
    lastHunkAdditionEnd =
      hunk.additionCount === 0
        ? hunk.additionStart
        : hunk.additionStart + hunk.additionCount - 1;
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
    // Clamp to 0: a diff whose addition side is empty (file deleted to
    // nothing) has additionStart 0 / additionCount 0, and without the clamp
    // the -1 end would invent a phantom trailing context line
    const lastHunkEnd = Math.max(
      lastHunk.additionCount === 0
        ? lastHunk.additionStart
        : lastHunk.additionStart + lastHunk.additionCount - 1,
      0
    );
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
  return collectAllElements(ast).filter(
    (node) => node.properties?.['data-line'] != null
  ).length;
}

// Count rows in split mode by looking at line-index values
// Each unique line-index represents one visual row in split view
export function countSplitRows(result: HunksRenderResult): number {
  const lineIndices = new Set<number>();
  const { additionsContentAST = [], deletionsContentAST = [] } = result;

  for (const nodes of [additionsContentAST, deletionsContentAST]) {
    const allElements = collectAllElements(nodes);
    for (const node of allElements) {
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
  return lineIndices.size;
}

// Behavioral projections
//
// These flatten rendered HAST columns and parsed diffs into small, readable
// structures so tests can assert (or snapshot) just the behavior they own —
// row order, line numbers, types, text — instead of pinning entire render
// results that churn on every theme or tokenizer change.

// Recursively concatenates the text nodes under a HAST node.
export function hastTextContent(node: ElementContent): string {
  if (node.type === 'text') {
    return node.value;
  }
  if (!isHastElement(node)) {
    return '';
  }
  let text = '';
  for (const child of node.children) {
    text += hastTextContent(child);
  }
  return text;
}

export interface ProjectedRow {
  kind: 'line' | 'buffer' | 'no-newline' | 'separator' | 'annotation' | 'other';
  unifiedIndex?: number;
  splitIndex?: number;
  lineNumber?: number;
  altLineNumber?: number;
  lineType?: string;
  text?: string;
  bufferSize?: number;
  separator?: string;
  annotationIndex?: string;
}

// Projects the top-level nodes of a rendered content column into one
// ProjectedRow per visual row. Line rows capture their indices, numbers, type,
// and exact text (processLine pads empty rows with a lone newline for
// copy/paste; that padding is stripped so text matches the source verbatim).
export function projectColumn(ast: ElementContent[]): ProjectedRow[] {
  const rows: ProjectedRow[] = [];
  for (const node of ast) {
    if (!isHastElement(node)) {
      continue;
    }
    const props = node.properties ?? {};
    if (props['data-line'] != null) {
      const lineIndex =
        typeof props['data-line-index'] === 'string'
          ? props['data-line-index']
          : '';
      const [unifiedStr, splitStr] = lineIndex.split(',');
      const unifiedIndex = Number.parseInt(unifiedStr, 10);
      const splitIndex = Number.parseInt(splitStr, 10);
      let text = hastTextContent(node);
      if (text.endsWith('\n')) {
        text = text.slice(0, -1);
      }
      rows.push({
        kind: 'line',
        unifiedIndex: Number.isNaN(unifiedIndex) ? undefined : unifiedIndex,
        splitIndex: Number.isNaN(splitIndex) ? undefined : splitIndex,
        lineNumber: Number(props['data-line']),
        altLineNumber:
          props['data-alt-line'] != null
            ? Number(props['data-alt-line'])
            : undefined,
        lineType:
          typeof props['data-line-type'] === 'string'
            ? props['data-line-type']
            : undefined,
        text,
      });
    } else if ('data-content-buffer' in props) {
      rows.push({
        kind: 'buffer',
        bufferSize: Number(props['data-buffer-size']),
      });
    } else if ('data-no-newline' in props) {
      rows.push({ kind: 'no-newline' });
    } else if (props['data-separator'] != null) {
      rows.push({
        kind: 'separator',
        separator: String(props['data-separator']),
      });
    } else if (props['data-line-annotation'] != null) {
      rows.push({
        kind: 'annotation',
        annotationIndex: String(props['data-line-annotation']),
      });
    } else {
      rows.push({ kind: 'other' });
    }
  }
  return rows;
}

export interface RenderResultProjection {
  unified: ProjectedRow[] | undefined;
  deletions: ProjectedRow[] | undefined;
  additions: ProjectedRow[] | undefined;
  bufferBefore: number;
  bufferAfter: number;
}

export function projectRenderResult(
  result: HunksRenderResult
): RenderResultProjection {
  return {
    unified:
      result.unifiedContentAST != null
        ? projectColumn(result.unifiedContentAST)
        : undefined,
    deletions:
      result.deletionsContentAST != null
        ? projectColumn(result.deletionsContentAST)
        : undefined,
    additions:
      result.additionsContentAST != null
        ? projectColumn(result.additionsContentAST)
        : undefined,
    bufferBefore: result.bufferBefore,
    bufferAfter: result.bufferAfter,
  };
}

// Renders each projected row as one short reviewable line, for compact
// snapshots whose diffs a human (or review agent) can actually read.
export function rowDigests(rows: ProjectedRow[]): string[] {
  return rows.map((row) => {
    switch (row.kind) {
      case 'line': {
        const alt =
          row.altLineNumber != null && row.altLineNumber !== row.lineNumber
            ? `(alt ${row.altLineNumber})`
            : '';
        return `u${row.unifiedIndex}/s${row.splitIndex} ${row.lineType} #${row.lineNumber}${alt} |${row.text}|`;
      }
      case 'buffer':
        return `buffer x${row.bufferSize}`;
      case 'separator':
        return `separator ${row.separator}`;
      case 'annotation':
        return `annotation ${row.annotationIndex}`;
      default:
        return row.kind;
    }
  });
}

export interface AnnotationProjectionEntry {
  lineIndex: string | undefined;
  annotationIndex: string;
  slotNames: (string | undefined)[];
}

// Walks a rendered column in document order and pairs every annotation
// element with the data-line-index of the line row preceding it.
export function annotationProjection(
  ast: ElementContent[]
): AnnotationProjectionEntry[] {
  const entries: AnnotationProjectionEntry[] = [];
  let lastLineIndex: string | undefined;
  for (const node of collectAllElements(ast)) {
    if (isHastLineElement(node)) {
      lastLineIndex = getHastLineIndex(node);
      continue;
    }
    if (!isHastAnnotationElement(node)) {
      continue;
    }
    const annotationIndex = getHastAnnotationIndex(node);
    if (annotationIndex == null) {
      continue;
    }
    entries.push({
      lineIndex: lastLineIndex,
      annotationIndex,
      slotNames: findHastSlotElements(node).map((slot) =>
        typeof slot.properties?.name === 'string'
          ? slot.properties.name
          : undefined
      ),
    });
  }
  return entries;
}

// Compares rendered line-row text against the original source lines and
// returns one message per mismatch. Side semantics: split columns are
// single-sided (deletions = old file, additions = new file); the unified
// column carries the old-file line number on change-deletion rows and the
// new-file number on every other row type.
export function collectRowSourceMismatches(
  rows: ProjectedRow[],
  column: 'unified' | 'deletions' | 'additions',
  oldLines: string[],
  newLines: string[]
): string[] {
  const mismatches: string[] = [];
  for (const row of rows) {
    if (row.kind !== 'line' || row.lineNumber == null) {
      continue;
    }
    const fromOld =
      column === 'deletions' ||
      (column === 'unified' && row.lineType === 'change-deletion');
    const source = fromOld ? oldLines : newLines;
    const expected = source[row.lineNumber - 1];
    if (row.text !== expected) {
      mismatches.push(
        `${column} #${row.lineNumber} (${row.lineType}): rendered ${JSON.stringify(row.text)} !== source ${JSON.stringify(expected)}`
      );
    }
  }
  return mismatches;
}

// Number of rows a full render or iteration emits for a diff: each hunk's
// declared rows plus any collapsed gap at or under the collapsed-context
// threshold, which is rendered as auto-expanded context rows instead of being
// hidden behind a separator.
export function countDeclaredRows(
  diff: FileDiffMetadata,
  style: 'split' | 'unified',
  collapsedContextThreshold: number = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD
): number {
  let count = 0;
  for (const hunk of diff.hunks) {
    count += style === 'split' ? hunk.splitLineCount : hunk.unifiedLineCount;
    if (
      hunk.collapsedBefore > 0 &&
      hunk.collapsedBefore <= collapsedContextThreshold
    ) {
      count += hunk.collapsedBefore;
    }
  }
  return count;
}

// Compact, reviewable summary of a parsed file diff for snapshots: hunk
// geometry and file totals without the full line arrays or rendered output.
// Each hunk renders as one line — additions/deletions as count@start, then
// the split/unified row counts and the collapsed run preceding the hunk.
export function hunkDigest(file: FileDiffMetadata): {
  name: string;
  prevName: string | undefined;
  type: string;
  hunks: string[];
  totals: string;
} {
  return {
    name: file.name,
    prevName: file.prevName,
    type: file.type,
    hunks: file.hunks.map(
      (hunk) =>
        `a${hunk.additionCount}@${hunk.additionStart} d${hunk.deletionCount}@${hunk.deletionStart} split:${hunk.splitLineCount} unified:${hunk.unifiedLineCount} collapsedBefore:${hunk.collapsedBefore}`
    ),
    totals: `split:${file.splitLineCount} unified:${file.unifiedLineCount} additionLines:${file.additionLines.length} deletionLines:${file.deletionLines.length}`,
  };
}

export function patchDigest(
  patches: ParsedPatch[]
): Array<{ patchIndex: number; files: ReturnType<typeof hunkDigest>[] }> {
  return patches.map((patch, patchIndex) => ({
    patchIndex,
    files: patch.files.map(hunkDigest),
  }));
}

export function extractLineNumbers(ast: ElementContent[]): {
  unifiedIndices: number[];
  splitIndices: number[];
} {
  const unifiedIndices: number[] = [];
  const splitIndices: number[] = [];
  const allElements = collectAllElements(ast);

  for (const node of allElements) {
    if (node.properties?.['data-line'] != null) {
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
