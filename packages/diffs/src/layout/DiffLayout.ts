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
import { createGutterGap, createGutterItem } from '../utils/hast_utils';
import {
  FILE_ANNOTATION_HUNK_INDEX,
  FILE_ANNOTATION_LINE_INDEX,
  getFileAnnotations,
  shouldRenderFileAnnotations,
} from '../utils/includesFileAnnotations';
import { iterateOverDiff } from '../utils/iterateOverDiff';
import { getTrailingContextRangeSize } from '../utils/virtualDiffLayout';
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
  model: DiffModel;
  rows: RowSource;
  renderRange: RenderRange;
  expandedHunks: Map<number, HunkExpansionRegion>;
  deletionAnnotations: AnnotationLineMap<LAnnotation>;
  additionAnnotations: AnnotationLineMap<LAnnotation>;
  annotationSlotName(annotation: DiffLineAnnotation<LAnnotation>): string;
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

interface StampedRow {
  properties: Properties;
  row: HASTElement;
}

interface GutterCell {
  lineType: LineTypes;
  lineNumber: number;
  lineIndexText: string;
  properties: Properties;
  cell: HASTElement;
}

interface FixedRow {
  signature: string;
  gutter: HASTElement;
  content: HASTElement;
}

// Rows pushed into one column, with the key of the last one for keys that
// hang off their neighbor.
interface Column {
  specs: RowSpec[];
  lastKey: RowKey | undefined;
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
  readonly #marked = new WeakMap<HASTElement, MarkedRow>();
  readonly #stamped = new WeakMap<HASTElement, StampedRow>();
  // Gutter cells by the highlight row they were built for, reused while the
  // line number, type and decoration match so the element is kept too.
  readonly #gutters = new WeakMap<HASTElement, GutterCell>();
  // The highlight row each content row was built from, so a row that only
  // got new attributes (a new line index, say) still finds its gutter cell.
  readonly #baseOf = new WeakMap<HASTElement, HASTElement>();
  // Rows that are not built from a line, kept by key while their inputs
  // match, so a render that changes nothing hands back the same objects.
  readonly #fixedRows = new Map<RowKey, FixedRow>();

  constructor(
    private options: DiffLayoutOptions,
    private readonly host: DiffHunksRenderer<LAnnotation>
  ) {
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

  /**
   * Drops the rows kept for lines an edit removed: their annotation rows and
   * the buffers that followed them.
   */
  forgetLines(ids: readonly number[]): void {
    for (const id of ids) {
      this.#fixedRows.delete(`ann:a${id}`);
      this.#fixedRows.delete(`buf:a${id}`);
      this.#fixedRows.delete(`buf:ann:a${id}`);
    }
  }

  layout(input: DiffLayoutInput<LAnnotation>): DiffLayoutResult {
    const { model, rows, renderRange, expandedHunks } = input;
    const { diff } = model;
    const {
      diffStyle,
      expandUnchanged,
      expansionLineCount,
      collapsedContextThreshold,
      hunkSeparators,
      canHydrateContext,
    } = this.options;
    const { host } = this;
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
      this.#pushFixedRow(column, bufferKey(column), `${size}`, () => ({
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
      this.#pushFixedRow(
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
            gutter: this.#gutter(
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
              gutter: this.#gutter(
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
              gutter: this.#gutter(
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
        if (noEOFCRAddition || noEOFCRDeletion) {
          flushBuffer();
          if (noEOFCRDeletion) {
            const noEOFType: LineTypes =
              type === 'context' || type === 'context-expanded'
                ? type
                : 'change-deletion';
            this.#pushFixedRow(
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
              this.#pushFixedRow(
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
            this.#pushFixedRow(
              unified ? columns.unified : columns.additions,
              'eof:a',
              noEOFType,
              () => ({
                gutter: createGutterGap(noEOFType, 'metadata', 1),
                content: createNoNewlineElement(noEOFType),
              })
            );
            if (!unified && !noEOFCRDeletion) {
              this.#pushFixedRow(
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
      diff.additionLines.length,
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

  // A row that is not built from a line: a filler, separator, annotation or
  // "no newline" row. Reused while its signature matches.
  #pushFixedRow(
    column: Column,
    key: RowKey,
    signature: string,
    create: () => { gutter: HASTElement; content: HASTElement }
  ): void {
    let fixed = this.#fixedRows.get(key);
    if (fixed == null || fixed.signature !== signature) {
      fixed = { signature, ...create() };
      this.#fixedRows.set(key, fixed);
    }
    pushRow(column, { key, gutter: fixed.gutter, content: fixed.content });
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
      this.#pushFixedRow(
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
      this.#pushFixedRow(
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
    this.#pushFixedRow(
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
  // attributes. Both steps reuse their last result while the inputs match.
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
    // Line attributes in one order for every row, whichever source built it.
    const properties: Properties = {
      ...marked.properties,
      'data-line': lineNumber,
      'data-alt-line': altLineNumber,
      'data-line-type':
        contentProperties?.['data-line-type'] ??
        marked.properties['data-line-type'],
      'data-line-index': lineIndexText,
      ...contentProperties,
    };
    const cached = this.#stamped.get(marked);
    if (cached != null && arePropertiesEqual(cached.properties, properties)) {
      return cached.row;
    }
    const row: HASTElement = { ...marked, properties };
    this.#stamped.set(marked, { properties, row });
    this.#baseOf.set(row, base);
    return row;
  }

  // The gutter cell for a line, cached by its highlight row and reused while
  // the line number, type and host properties match.
  #gutter(
    content: HASTElement,
    lineType: LineTypes,
    lineNumber: number,
    lineIndexText: string,
    properties: Properties = {}
  ): HASTElement {
    const base = this.#baseOf.get(content) ?? content;
    const cached = this.#gutters.get(base);
    if (
      cached != null &&
      cached.lineType === lineType &&
      cached.lineNumber === lineNumber &&
      cached.lineIndexText === lineIndexText &&
      arePropertiesEqual(cached.properties, properties)
    ) {
      return cached.cell;
    }
    const cell = createGutterItem(
      lineType,
      lineNumber,
      lineIndexText,
      properties
    );
    // Same line number means only attributes changed, so keep the children
    // and let the reconciler patch attributes alone.
    if (cached != null && cached.lineNumber === lineNumber) {
      cell.children = cached.cell.children;
    }
    this.#gutters.set(base, {
      lineType,
      lineNumber,
      lineIndexText,
      properties,
      cell,
    });
    return cell;
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

// Content cells that are not document lines, such as annotation rows and
// separators, are never editable, so the caret cannot enter them while the
// column is. Added on every render so attaching an editor changes no rows.
function readOnly(cell: HASTElement): HASTElement {
  return {
    ...cell,
    properties: { ...cell.properties, contenteditable: 'false' },
  };
}

function createColumn(): Column {
  return { specs: [], lastKey: undefined };
}

// The key of a filler row: it follows the row before it, or opens the column.
function bufferKey(column: Column): RowKey {
  return `buf:${column.lastKey ?? 'top'}`;
}

function pushRow(column: Column, spec: RowSpec): void {
  column.specs.push(spec);
  column.lastKey = spec.key;
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

function arePropertiesEqual(a: Properties, b: Properties): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
