import type { ElementContent, Element as HASTElement, Properties } from 'hast';

import type { DiffModel } from '../model/DiffModel';
import type { DiffHunksRenderer } from '../renderers/DiffHunksRenderer';
import { LineDiffRangeCache } from '../rows/lineDiffRanges';
import { markRow } from '../rows/markRow';
import type { RowSource } from '../rows/RowSource';
import type {
  AnnotationLineMap,
  AnnotationSpan,
  CodeColumnType,
  DiffLineAnnotation,
  HunkData,
  HunkExpansionRegion,
  HunkSeparators,
  LineDiffTypes,
  LineTypes,
  RenderRange,
} from '../types';
import type { LineDiffRange } from '../utils/computeLineDiffRanges';
import { createEmptyRowBuffer } from '../utils/createEmptyRowBuffer';
import { createNoNewlineElement } from '../utils/createNoNewlineElement';
import { createSeparator } from '../utils/createSeparator';
import { getHunkSeparatorSlotName } from '../utils/getHunkSeparatorSlotName';
import { getTotalLineCountFromHunks } from '../utils/getTotalLineCountFromHunks';
import { createGutterGap } from '../utils/hast_utils';
import {
  FILE_ANNOTATION_HUNK_INDEX,
  FILE_ANNOTATION_LINE_INDEX,
  getFileAnnotations,
  shouldRenderFileAnnotations,
} from '../utils/includesFileAnnotations';
import { iterateOverDiff } from '../utils/iterateOverDiff';
import { getTrailingContextRangeSize } from '../utils/virtualDiffLayout';
import {
  type Column,
  createColumn,
  pushRow,
  readOnly,
  RowCells,
} from './RowCells';
import type {
  InjectedRow,
  LayoutColumns,
  LineKey,
  RenderedLineContext,
  RowKey,
  RowSpec,
  SplitInjectedRow,
} from './RowSpec';

export interface DiffLayoutOptions {
  diffStyle: 'unified' | 'split';
  expandUnchanged: boolean;
  expansionLineCount: number;
  collapsedContextThreshold: number;
  hunkSeparators: HunkSeparators;
  lineDiffType: LineDiffTypes;
  maxLineDiffLength: number;
  /** Collapsed context can still be loaded, so every gap is expandable. */
  canHydrateContext: boolean;
}

export interface DiffLayoutInput<LAnnotation> {
  host: DiffHunksRenderer<LAnnotation>;
  model: DiffModel;
  rows: RowSource;
  renderRange: RenderRange;
  expandedHunks: Map<number, HunkExpansionRegion>;
  deletionAnnotations: AnnotationLineMap<LAnnotation>;
  additionAnnotations: AnnotationLineMap<LAnnotation>;
  annotationSlotName(annotation: DiffLineAnnotation<LAnnotation>): string;
  /**
   * Give the empty line after the new file's final line break a row of its
   * own; see IterateOverDiffProps.includeTrailingNewline.
   */
  includeTrailingNewline: boolean;
  /** Render the "No newline at end of file" marker rows. */
  showNoNewlineMarkers: boolean;
}

export interface DiffLayoutResult {
  columns: LayoutColumns;
  hunkData: HunkData[];
  rowCount: number;
  totalLines: number;
}

interface MarkedRow {
  ranges: readonly LineDiffRange[];
  row: HASTElement;
}

// Filler rows a split view owes one column so both columns stay aligned.
interface PendingSplitBuffer {
  size: number;
  side: 'additions' | 'deletions' | undefined;
}

interface SeparatorProps {
  hunkIndex: number;
  collapsedLines: number | 'unknown';
  rangeSize: number;
  hunkSpecs: string | undefined;
  isFirstHunk: boolean;
  isLastHunk: boolean;
  isExpandable: boolean;
}

const NO_RANGES: readonly LineDiffRange[] = Object.freeze([]);

/**
 * Places the rows of a diff for one render: which lines show, in which
 * column, with which separators, annotation rows, filler rows and "no
 * newline" markers between them. Each row's content is its base row from
 * the row source with the word diff marks of its current pair, stamped with
 * its line attributes. Rows are memoized on their inputs, so a row that did
 * not change is the same object as last time.
 */
export class DiffLayout<LAnnotation = undefined> {
  #ranges: LineDiffRangeCache;
  readonly #cells = new RowCells();
  readonly #marked = new WeakMap<HASTElement, MarkedRow>();

  constructor(private options: DiffLayoutOptions) {
    this.#ranges = new LineDiffRangeCache(
      options.lineDiffType,
      options.maxLineDiffLength
    );
  }

  setOptions(options: DiffLayoutOptions): void {
    if (
      options.lineDiffType !== this.options.lineDiffType ||
      options.maxLineDiffLength !== this.options.maxLineDiffLength
    ) {
      this.#ranges = new LineDiffRangeCache(
        options.lineDiffType,
        options.maxLineDiffLength
      );
    }
    this.options = options;
  }

  /** Drops the rows kept for lines an edit removed. */
  forgetLines(ids: readonly number[]): void {
    this.#cells.forgetLines(ids);
  }

  layout(input: DiffLayoutInput<LAnnotation>): DiffLayoutResult {
    const {
      host,
      model,
      rows,
      renderRange,
      expandedHunks,
      includeTrailingNewline,
      showNoNewlineMarkers,
    } = input;
    const { diff } = model;
    const {
      diffStyle,
      expandUnchanged,
      expansionLineCount,
      collapsedContextThreshold,
      hunkSeparators,
      canHydrateContext,
    } = this.options;
    const unified = diffStyle === 'unified';
    const isExpandableDiff = !diff.isPartial || canHydrateContext;
    const marks = this.options.lineDiffType !== 'none';

    const columns = {
      unified: createColumn(),
      deletions: createColumn(),
      additions: createColumn(),
    };
    const hunkData: HunkData[] = [];
    let rowCount = 0;
    const pendingBuffer: PendingSplitBuffer = { size: 0, side: undefined };

    const flushBuffer = () => {
      if (unified) return;
      const { size, side } = pendingBuffer;
      pendingBuffer.size = 0;
      pendingBuffer.side = undefined;
      if (size <= 0 || side == null) return;
      const column = columns[side];
      this.#cells.fixedRow(column, bufferKey(column), `${size}`, () => ({
        gutter: createGutterGap(undefined, 'buffer', size),
        content: createEmptyRowBuffer(size),
      }));
    };

    const pushSeparators = (props: SeparatorProps) => {
      flushBuffer();
      const types: CodeColumnType[] = unified
        ? ['unified']
        : ['deletions', 'additions'];
      for (const type of types) {
        const rowsAdded = this.#pushSeparator(
          columns[type],
          type,
          props,
          hunkSeparators,
          expansionLineCount,
          hunkData
        );
        if (rowsAdded && type !== 'additions') rowCount++;
      }
    };

    // An annotation row is keyed by the line it hangs under, so it follows
    // that line through edits.
    const pushAnnotationRow = (
      column: Column,
      lineKey: LineKey | 'file',
      span: AnnotationSpan,
      lineType: LineTypes
    ) => {
      this.#cells.fixedRow(
        column,
        `ann:${lineKey}`,
        `${lineType}|${span.hunkIndex},${span.lineIndex}|${span.annotations.join(',')}`,
        () => ({
          gutter: createGutterGap(lineType, 'annotation', 1),
          content: readOnly(host.createAnnotationElement(span)),
        })
      );
    };

    this.#pushFileAnnotations(input, columns, pushAnnotationRow, () => {
      rowCount++;
    });

    const trailingRangeSize = getTrailingContextRangeSize({
      fileDiff: diff,
      errorPrefix: 'DiffLayout.layout',
    });

    iterateOverDiff({
      diff,
      diffStyle,
      startingLine: renderRange.startingLine,
      totalLines: renderRange.totalLines,
      expandedHunks: expandUnchanged ? true : expandedHunks,
      collapsedContextThreshold,
      includeTrailingNewline,
      callback: ({
        hunkIndex,
        hunk,
        collapsedBefore,
        collapsedAfter,
        additionLine,
        deletionLine,
        type,
      }) => {
        const splitLineIndex =
          deletionLine != null
            ? deletionLine.splitLineIndex
            : additionLine.splitLineIndex;
        const unifiedLineIndex =
          additionLine != null
            ? additionLine.unifiedLineIndex
            : deletionLine.unifiedLineIndex;

        if (!unified && type !== 'change') {
          flushBuffer();
        }

        if (collapsedBefore > 0) {
          pushSeparators({
            hunkIndex,
            collapsedLines: collapsedBefore,
            rangeSize: Math.max(hunk?.collapsedBefore ?? 0, 0),
            hunkSpecs: hunk?.hunkSpecs,
            isFirstHunk: hunkIndex === 0,
            isLastHunk: false,
            isExpandable: isExpandableDiff,
          });
        }

        const lineIndex = unified ? unifiedLineIndex : splitLineIndex;
        const lineContext: RenderedLineContext = {
          type,
          hunkIndex,
          lineIndex,
          unifiedLineIndex,
          splitLineIndex,
          deletionLine,
          additionLine,
        };

        // Word diff marks come from each changed line's current pair. In
        // unified view the two sides of a pair arrive as separate rows.
        const deletionRanges =
          marks && type === 'change' && deletionLine != null
            ? this.#rangesFor(model, 'deletions', deletionLine.lineIndex)
            : NO_RANGES;
        const additionRanges =
          marks && type === 'change' && additionLine != null
            ? this.#rangesFor(model, 'additions', additionLine.lineIndex)
            : NO_RANGES;

        const additionKey: LineKey | undefined =
          additionLine != null
            ? `a${model.lineId(additionLine.lineIndex)}`
            : undefined;
        const deletionKey: LineKey | undefined =
          deletionLine != null ? `d${deletionLine.lineIndex}` : undefined;
        // The unified row shows the new line when there is one; a split
        // column's rows hang off that column's own line when it has one.
        const lineKey = additionKey ?? deletionKey!;
        const deletionsKey = deletionKey ?? additionKey!;
        const additionsKey = additionKey ?? deletionKey!;

        if (unified) {
          const injected = host.getUnifiedInjectedRowsForLine?.(lineContext);
          if (injected?.before != null) {
            rowCount += pushUnifiedInjectedRows(
              columns.unified,
              injected.before,
              `${lineKey}:before`
            );
          }
          const lineType: LineTypes =
            type === 'change'
              ? additionLine != null
                ? 'change-addition'
                : 'change-deletion'
              : type;
          const decoration = host.getUnifiedLineDecoration({
            type,
            lineType,
            additionLineIndex: additionLine?.lineIndex,
            deletionLineIndex: deletionLine?.lineIndex,
          });
          const lineNumber =
            additionLine != null
              ? additionLine.lineNumber
              : deletionLine.lineNumber;
          const lineIndexText = `${unifiedLineIndex},${splitLineIndex}`;
          // A unified row shows the new line when there is one.
          const content =
            additionLine != null
              ? this.#line(
                  rows.additionRow(model, additionLine.lineIndex),
                  additionRanges,
                  decoration.contentProperties,
                  additionLine.lineNumber,
                  type === 'change' ? undefined : deletionLine?.lineNumber,
                  lineIndexText
                )
              : this.#line(
                  rows.deletionRow(model, deletionLine.lineIndex),
                  deletionRanges,
                  { ...decoration.contentProperties, contenteditable: 'false' },
                  deletionLine.lineNumber,
                  undefined,
                  lineIndexText
                );
          pushRow(columns.unified, {
            key: lineKey,
            gutter: this.#cells.gutter(
              content,
              decoration.gutterLineType,
              lineNumber,
              lineIndexText,
              decoration.gutterProperties
            ),
            content,
          });
          const span = getUnifiedAnnotationSpan(
            input,
            deletionLine?.lineNumber,
            additionLine?.lineNumber,
            hunkIndex,
            lineIndex
          );
          if (span != null) {
            pushAnnotationRow(columns.unified, lineKey, span, lineType);
            rowCount++;
          }
          if (injected?.after != null) {
            rowCount += pushUnifiedInjectedRows(
              columns.unified,
              injected.after,
              `${lineKey}:after`
            );
          }
        } else {
          const injected = host.getSplitInjectedRowsForLine?.(lineContext);
          if (injected?.before != null) {
            rowCount += pushSplitInjectedRows(
              columns,
              injected.before,
              `${lineKey}:before`,
              pendingBuffer,
              flushBuffer
            );
          }
          const deletionDecoration = host.getSplitLineDecoration({
            side: 'deletions',
            type,
            lineIndex: deletionLine?.lineIndex,
          });
          const additionDecoration = host.getSplitLineDecoration({
            side: 'additions',
            type,
            lineIndex: additionLine?.lineIndex,
          });

          const missingSide =
            type === 'change'
              ? additionLine == null
                ? 'additions'
                : deletionLine == null
                  ? 'deletions'
                  : undefined
              : undefined;
          if (missingSide != null) {
            if (
              pendingBuffer.side != null &&
              pendingBuffer.side !== missingSide
            ) {
              flushBuffer();
            }
            pendingBuffer.side = missingSide;
            pendingBuffer.size += 1;
          } else if (type === 'change') {
            // A change row with both sides fills the column a one-sided
            // buffer was holding open; the buffer lands above this row.
            flushBuffer();
          }

          const spans = getSplitAnnotationSpans(
            input,
            deletionLine?.lineNumber,
            additionLine?.lineNumber,
            hunkIndex,
            lineIndex
          );
          if (spans != null && pendingBuffer.size > 0) {
            flushBuffer();
          }

          if (deletionLine != null) {
            const lineIndexText = `${deletionLine.unifiedLineIndex},${splitLineIndex}`;
            const content = this.#line(
              rows.deletionRow(model, deletionLine.lineIndex),
              deletionRanges,
              deletionDecoration.contentProperties,
              deletionLine.lineNumber,
              type === 'change' ? undefined : additionLine?.lineNumber,
              lineIndexText
            );
            pushRow(columns.deletions, {
              key: deletionsKey,
              gutter: this.#cells.gutter(
                content,
                deletionDecoration.gutterLineType,
                deletionLine.lineNumber,
                lineIndexText,
                deletionDecoration.gutterProperties
              ),
              content,
            });
          }
          if (additionLine != null) {
            const lineIndexText = `${additionLine.unifiedLineIndex},${splitLineIndex}`;
            const content = this.#line(
              rows.additionRow(model, additionLine.lineIndex),
              additionRanges,
              additionDecoration.contentProperties,
              additionLine.lineNumber,
              type === 'change' ? undefined : deletionLine?.lineNumber,
              lineIndexText
            );
            pushRow(columns.additions, {
              key: additionsKey,
              gutter: this.#cells.gutter(
                content,
                additionDecoration.gutterLineType,
                additionLine.lineNumber,
                lineIndexText,
                additionDecoration.gutterProperties
              ),
              content,
            });
          }
          if (spans != null) {
            pushAnnotationRow(
              columns.deletions,
              deletionsKey,
              spans.deletionSpan,
              type === 'change'
                ? deletionLine != null
                  ? 'change-deletion'
                  : 'context'
                : type
            );
            pushAnnotationRow(
              columns.additions,
              additionsKey,
              spans.additionSpan,
              type === 'change'
                ? additionLine != null
                  ? 'change-addition'
                  : 'context'
                : type
            );
            rowCount++;
          }
          if (injected?.after != null) {
            rowCount += pushSplitInjectedRows(
              columns,
              injected.after,
              `${lineKey}:after`,
              pendingBuffer,
              flushBuffer
            );
          }
        }

        const isFinalSplitHunkRow =
          !unified &&
          hunk != null &&
          splitLineIndex === hunk.splitLineStart + hunk.splitLineCount - 1;
        const isFinalHunkRow =
          hunkIndex === diff.hunks.length - 1 &&
          hunk != null &&
          (unified
            ? unifiedLineIndex ===
              hunk.unifiedLineStart + hunk.unifiedLineCount - 1
            : splitLineIndex === hunk.splitLineStart + hunk.splitLineCount - 1);
        const noEOFCRDeletion =
          (deletionLine?.noEOFCR ?? false) ||
          (isFinalSplitHunkRow && hunk.noEOFCRDeletions);
        const noEOFCRAddition =
          (additionLine?.noEOFCR ?? false) ||
          (isFinalSplitHunkRow && hunk.noEOFCRAdditions);
        if (showNoNewlineMarkers && (noEOFCRAddition || noEOFCRDeletion)) {
          flushBuffer();
          if (noEOFCRDeletion) {
            const noEOFType: LineTypes =
              type === 'context' || type === 'context-expanded'
                ? type
                : 'change-deletion';
            this.#cells.fixedRow(
              unified ? columns.unified : columns.deletions,
              'eof:d',
              noEOFType,
              () => {
                // A deleted line's marker is not part of the document.
                const marker = createNoNewlineElement(noEOFType);
                return {
                  gutter: createGutterGap(noEOFType, 'metadata', 1),
                  content:
                    noEOFType === 'change-deletion' ? readOnly(marker) : marker,
                };
              }
            );
            if (!unified && !noEOFCRAddition) {
              this.#cells.fixedRow(
                columns.additions,
                bufferKey(columns.additions),
                '1',
                () => ({
                  gutter: createGutterGap(undefined, 'buffer', 1),
                  content: createEmptyRowBuffer(1),
                })
              );
            }
          }
          if (
            noEOFCRAddition &&
            !(unified && noEOFCRDeletion && type !== 'change')
          ) {
            const noEOFType: LineTypes =
              type === 'context' || type === 'context-expanded'
                ? type
                : 'change-addition';
            this.#cells.fixedRow(
              unified ? columns.unified : columns.additions,
              'eof:a',
              noEOFType,
              () => ({
                gutter: createGutterGap(noEOFType, 'metadata', 1),
                content: createNoNewlineElement(noEOFType),
              })
            );
            if (!unified && !noEOFCRDeletion) {
              this.#cells.fixedRow(
                columns.deletions,
                bufferKey(columns.deletions),
                '1',
                () => ({
                  gutter: createGutterGap(undefined, 'buffer', 1),
                  content: createEmptyRowBuffer(1),
                })
              );
            }
          }
          rowCount++;
        }

        if (
          hunkSeparators !== 'simple' &&
          hunkSeparators !== 'metadata' &&
          (collapsedAfter > 0 || (isFinalHunkRow && canHydrateContext))
        ) {
          pushSeparators({
            hunkIndex: type === 'context-expanded' ? hunkIndex : hunkIndex + 1,
            collapsedLines:
              isFinalHunkRow && canHydrateContext ? 'unknown' : collapsedAfter,
            rangeSize: trailingRangeSize,
            hunkSpecs: undefined,
            isFirstHunk: false,
            isLastHunk: true,
            isExpandable: isExpandableDiff,
          });
        }
        rowCount++;
      },
    });

    flushBuffer();

    const totalLines = Math.max(
      getTotalLineCountFromHunks(diff.hunks),
      model.lineCount,
      diff.deletionLines.length
    );
    const hasBuffer =
      renderRange.bufferBefore > 0 || renderRange.bufferAfter > 0;
    const hasContent = rowCount > 0 || hasBuffer;
    const includeAdditions = !unified && diff.type !== 'deleted';
    const includeDeletions = !unified && diff.type !== 'new';
    return {
      columns: {
        unified: unified && hasContent ? columns.unified.specs : undefined,
        deletions:
          includeDeletions && hasContent ? columns.deletions.specs : undefined,
        additions:
          includeAdditions && hasContent ? columns.additions.specs : undefined,
      },
      hunkData,
      rowCount,
      totalLines,
    };
  }

  // The marks on one side of a changed line's pair, or none when the line
  // has no partner.
  #rangesFor(
    model: DiffModel,
    side: 'deletions' | 'additions',
    lineIndex: number
  ): readonly LineDiffRange[] {
    const partner = model.pairFor(side, lineIndex);
    if (partner == null) {
      return NO_RANGES;
    }
    const { deletionLines, additionLines } = model.diff;
    const ranges =
      side === 'deletions'
        ? this.#ranges.get(
            lineIndex,
            deletionLines[lineIndex],
            additionLines[partner]
          )
        : this.#ranges.get(
            partner,
            deletionLines[partner],
            additionLines[lineIndex]
          );
    return side === 'deletions' ? ranges.deletion : ranges.addition;
  }

  // Adds a separator row to one column. Returns whether a row was added.
  #pushSeparator(
    column: Column,
    type: CodeColumnType,
    {
      hunkIndex,
      collapsedLines,
      rangeSize,
      hunkSpecs,
      isFirstHunk,
      isLastHunk,
      isExpandable,
    }: SeparatorProps,
    hunkSeparators: HunkSeparators,
    expansionLineCount: number,
    hunkData: HunkData[]
  ): boolean {
    if (typeof collapsedLines === 'number' && collapsedLines <= 0) {
      return false;
    }
    if (hunkSeparators === 'metadata') {
      if (hunkSpecs == null) {
        return false;
      }
      const separator = () =>
        createSeparator({
          type: 'metadata',
          content: hunkSpecs,
          isFirstHunk,
          isLastHunk,
        });
      this.#cells.fixedRow(
        column,
        `sep:${type}:${hunkIndex}`,
        `metadata|${hunkSpecs}|${isFirstHunk}|${isLastHunk}`,
        () => ({
          gutter: separator(),
          content: readOnly(separator()),
        })
      );
      return true;
    }
    if (hunkSeparators === 'simple') {
      if (hunkIndex <= 0) {
        return false;
      }
      const separator = () =>
        createSeparator({ type: 'simple', isFirstHunk, isLastHunk: false });
      this.#cells.fixedRow(
        column,
        `sep:${type}:${hunkIndex}`,
        `simple|${isFirstHunk}`,
        () => ({
          gutter: separator(),
          content: readOnly(separator()),
        })
      );
      return true;
    }
    const slotName = getHunkSeparatorSlotName(type, hunkIndex);
    const chunked = rangeSize > expansionLineCount;
    const expandIndex = isExpandable ? hunkIndex : undefined;
    const content =
      typeof collapsedLines === 'number'
        ? getModifiedLinesString(collapsedLines)
        : 'More unchanged context may be available';
    const separator = () =>
      createSeparator({
        type: hunkSeparators,
        content,
        expandIndex,
        chunked,
        slotName,
        isFirstHunk,
        isLastHunk,
      });
    this.#cells.fixedRow(
      column,
      `sep:${slotName}`,
      `${hunkSeparators}|${content}|${expandIndex}|${chunked}|${isFirstHunk}|${isLastHunk}`,
      () => ({
        gutter: separator(),
        content: readOnly(separator()),
      })
    );
    hunkData.push({
      slotName,
      hunkIndex,
      lines: typeof collapsedLines === 'number' ? collapsedLines : 0,
      lineCountKnown: typeof collapsedLines === 'number',
      type,
      expandable: isExpandable
        ? { up: !isFirstHunk, down: !isLastHunk, chunked }
        : undefined,
    });
    return true;
  }

  // The content cell of a line: the base row with its marks, then its line
  // attributes. Marks reuse their last result while the ranges match.
  #line(
    base: HASTElement,
    ranges: readonly LineDiffRange[],
    contentProperties: Properties | undefined,
    lineNumber: number,
    altLineNumber: number | undefined,
    lineIndexText: string
  ): HASTElement {
    let marked = base;
    if (ranges.length > 0) {
      const cached = this.#marked.get(base);
      if (cached != null && areRangesEqual(cached.ranges, ranges)) {
        marked = cached.row;
      } else {
        marked = markRow(base, ranges);
        this.#marked.set(base, { ranges, row: marked });
      }
    }
    return this.#cells.line(
      marked,
      base,
      contentProperties,
      lineNumber,
      altLineNumber,
      lineIndexText
    );
  }

  #pushFileAnnotations(
    input: DiffLayoutInput<LAnnotation>,
    columns: Record<CodeColumnType, Column>,
    pushAnnotationRow: (
      column: Column,
      lineKey: LineKey | 'file',
      span: AnnotationSpan,
      lineType: LineTypes
    ) => void,
    countRow: () => void
  ): void {
    const { model, renderRange, deletionAnnotations, additionAnnotations } =
      input;
    if (!shouldRenderFileAnnotations(renderRange)) {
      return;
    }
    const { diff } = model;
    const names = (
      annotations: DiffLineAnnotation<LAnnotation>[] | undefined
    ) =>
      annotations?.map((annotation) => input.annotationSlotName(annotation)) ??
      [];
    const deletionNames =
      diff.type !== 'new' ? names(getFileAnnotations(deletionAnnotations)) : [];
    const additionNames =
      diff.type !== 'deleted'
        ? names(getFileAnnotations(additionAnnotations))
        : [];
    if (deletionNames.length === 0 && additionNames.length === 0) {
      return;
    }
    const hunkIndex = FILE_ANNOTATION_HUNK_INDEX;
    const lineIndex = FILE_ANNOTATION_LINE_INDEX;
    if (this.options.diffStyle === 'unified') {
      pushAnnotationRow(
        columns.unified,
        'file',
        {
          type: 'annotation',
          hunkIndex,
          lineIndex,
          annotations: deletionNames.concat(additionNames),
        },
        'context'
      );
    } else {
      pushAnnotationRow(
        columns.deletions,
        'file',
        {
          type: 'annotation',
          hunkIndex,
          lineIndex,
          annotations: deletionNames,
        },
        'context'
      );
      pushAnnotationRow(
        columns.additions,
        'file',
        {
          type: 'annotation',
          hunkIndex,
          lineIndex,
          annotations: additionNames,
        },
        'context'
      );
    }
    countRow();
  }
}

/** The gutter and content cells of a column's rows, in order. */
export function columnCells(specs: readonly RowSpec[]): {
  gutter: ElementContent[];
  content: ElementContent[];
} {
  return {
    gutter: specs.map((spec) => spec.gutter),
    content: specs.map((spec) => spec.content),
  };
}

// The key of a filler row: it follows the row before it, or opens the column.
function bufferKey(column: Column): RowKey {
  return `buf:${column.lastKey ?? 'top'}`;
}

// Where injected rows hang: the line they belong to and which side of it.
type InjectedRowAnchor = `${LineKey}:${'before' | 'after'}`;

// The key of an injected row: the host's id when it gave one, else its place
// at its anchor.
function injectedRowKey(
  row: InjectedRow,
  anchor: InjectedRowAnchor,
  index: number
): RowKey {
  return row.id != null ? `inj:${row.id}` : `inj:${anchor}:${index}`;
}

// Returns how many rows were added.
function pushUnifiedInjectedRows(
  column: Column,
  rows: InjectedRow[],
  anchor: InjectedRowAnchor
): number {
  for (const [index, row] of rows.entries()) {
    pushRow(column, {
      key: injectedRowKey(row, anchor, index),
      gutter: row.gutter,
      content: row.content,
    });
  }
  return rows.length;
}

// Returns how many rows were added.
function pushSplitInjectedRows(
  columns: Record<CodeColumnType, Column>,
  rows: SplitInjectedRow[],
  anchor: InjectedRowAnchor,
  pendingBuffer: PendingSplitBuffer,
  flushBuffer: () => void
): number {
  let added = 0;
  for (const [index, { deletion, addition }] of rows.entries()) {
    if (deletion == null && addition == null) {
      continue;
    }
    const missingSide =
      deletion != null && addition != null
        ? undefined
        : deletion == null
          ? 'deletions'
          : 'additions';
    if (missingSide == null || pendingBuffer.side !== missingSide) {
      flushBuffer();
    }
    if (deletion != null) {
      pushRow(columns.deletions, {
        key: injectedRowKey(deletion, anchor, index),
        gutter: deletion.gutter,
        content: deletion.content,
      });
    }
    if (addition != null) {
      pushRow(columns.additions, {
        key: injectedRowKey(addition, anchor, index),
        gutter: addition.gutter,
        content: addition.content,
      });
    }
    if (missingSide != null) {
      pendingBuffer.side = missingSide;
      pendingBuffer.size += 1;
    }
    added++;
  }
  return added;
}

function getUnifiedAnnotationSpan<LAnnotation>(
  input: DiffLayoutInput<LAnnotation>,
  deletionLineNumber: number | undefined,
  additionLineNumber: number | undefined,
  hunkIndex: number,
  lineIndex: number
): AnnotationSpan | undefined {
  const annotations: string[] = [];
  if (deletionLineNumber != null) {
    for (const annotation of input.deletionAnnotations[deletionLineNumber] ??
      []) {
      annotations.push(input.annotationSlotName(annotation));
    }
  }
  if (additionLineNumber != null) {
    for (const annotation of input.additionAnnotations[additionLineNumber] ??
      []) {
      annotations.push(input.annotationSlotName(annotation));
    }
  }
  return annotations.length > 0
    ? { type: 'annotation', hunkIndex, lineIndex, annotations }
    : undefined;
}

function getSplitAnnotationSpans<LAnnotation>(
  input: DiffLayoutInput<LAnnotation>,
  deletionLineNumber: number | undefined,
  additionLineNumber: number | undefined,
  hunkIndex: number,
  lineIndex: number
): { deletionSpan: AnnotationSpan; additionSpan: AnnotationSpan } | undefined {
  const deletionSpan: AnnotationSpan = {
    type: 'annotation',
    hunkIndex,
    lineIndex,
    annotations: [],
  };
  const additionSpan: AnnotationSpan = {
    type: 'annotation',
    hunkIndex,
    lineIndex,
    annotations: [],
  };
  if (deletionLineNumber != null) {
    for (const annotation of input.deletionAnnotations[deletionLineNumber] ??
      []) {
      deletionSpan.annotations.push(input.annotationSlotName(annotation));
    }
  }
  if (additionLineNumber != null) {
    for (const annotation of input.additionAnnotations[additionLineNumber] ??
      []) {
      additionSpan.annotations.push(input.annotationSlotName(annotation));
    }
  }
  if (
    deletionSpan.annotations.length === 0 &&
    additionSpan.annotations.length === 0
  ) {
    return undefined;
  }
  return { deletionSpan, additionSpan };
}

// Use the platform's English plural rules to pick "line" vs "lines" so a
// count of 0 reads as "0 unmodified lines". en-US returns "one" only for 1.
const EN_PLURAL_RULES = new Intl.PluralRules('en-US');

function getModifiedLinesString(lines: number): string {
  const suffix = EN_PLURAL_RULES.select(lines) === 'one' ? '' : 's';
  return `${lines} unmodified line${suffix}`;
}

function areRangesEqual(
  a: readonly LineDiffRange[],
  b: readonly LineDiffRange[]
): boolean {
  return (
    a === b ||
    (a.length === b.length &&
      a.every(
        (range, index) => range[0] === b[index][0] && range[1] === b[index][1]
      ))
  );
}
