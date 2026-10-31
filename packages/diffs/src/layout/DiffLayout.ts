import type { Element as HASTElement, Properties } from 'hast';

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
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
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
  /** The first and last new-file line numbers with a row in the window. */
  newFileLines: { first: number; last: number } | undefined;
  /**
   * The rows that differ from the last layout, per column, when lines marked
   * by an edit were the only change since it; undefined when the window was
   * walked.
   */
  patched: LayoutColumns | undefined;
  hunkData: HunkData[];
  rowCount: number;
  totalLines: number;
}

// The last walk: what it read and what it built, so marked lines can be
// rebuilt into it without a walk.
interface LastLayout<LAnnotation> {
  input: DiffLayoutInput<LAnnotation>;
  result: DiffLayoutResult;
}

// Whether a walk over `next` would read the same things as the walk over
// `last` did, apart from the lines' text and marks, which the marked lines
// account for.
function sameInputs<LAnnotation>(
  last: DiffLayoutInput<LAnnotation>,
  next: DiffLayoutInput<LAnnotation>
): boolean {
  return (
    last.host === next.host &&
    last.model === next.model &&
    last.rows === next.rows &&
    last.expandedHunks === next.expandedHunks &&
    last.deletionAnnotations === next.deletionAnnotations &&
    last.additionAnnotations === next.additionAnnotations &&
    last.annotationSlotName === next.annotationSlotName &&
    last.includeTrailingNewline === next.includeTrailingNewline &&
    last.showNoNewlineMarkers === next.showNoNewlineMarkers &&
    areRenderRangesEqual(last.renderRange, next.renderRange)
  );
}

interface MarkedRow {
  ranges: readonly LineDiffRange[];
  row: HASTElement;
}

// What a line's row is built from, kept by key after a walk so the row can
// be built again, through the same code, when only the line's text or marks
// changed.
interface LineRowInputs {
  column: keyof LayoutColumns;
  key: LineKey;
  side: 'deletions' | 'additions';
  lineIndex: number;
  marked: boolean;
  contentProperties: Properties | undefined;
  lineNumber: number;
  altLineNumber: number | undefined;
  lineIndexText: string;
  gutterLineType: LineTypes;
  gutterProperties: Properties | undefined;
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
 * not change is the same object as last time. When an edit marked lines and
 * nothing else changed since the last walk, the layout rebuilds those lines'
 * rows and their pairs' into the last result instead of walking again.
 */
export class DiffLayout<LAnnotation = undefined> {
  #ranges: LineDiffRangeCache;
  readonly #cells = new RowCells();
  readonly #markedRows = new WeakMap<HASTElement, MarkedRow>();
  // The line rows of the last walk, by key, with where each sits in its
  // column, so a marked line's row can be built again into the last result.
  readonly #lineRows = new Map<LineKey, LineRowInputs>();
  readonly #positions = new Map<LineKey, number>();
  #last: LastLayout<LAnnotation> | undefined;
  // Lines whose text or tokens changed since the last walk.
  #marked: Set<number> | undefined;

  constructor(private options: DiffLayoutOptions) {
    this.#ranges = new LineDiffRangeCache(
      options.lineDiffType,
      options.maxLineDiffLength
    );
  }

  setOptions(options: DiffLayoutOptions): void {
    const previous = this.options;
    if (
      options.lineDiffType !== previous.lineDiffType ||
      options.maxLineDiffLength !== previous.maxLineDiffLength
    ) {
      this.#ranges = new LineDiffRangeCache(
        options.lineDiffType,
        options.maxLineDiffLength
      );
    }
    // Every option shapes the walk, so a change means the next layout walks.
    if (
      options.diffStyle !== previous.diffStyle ||
      options.expandUnchanged !== previous.expandUnchanged ||
      options.expansionLineCount !== previous.expansionLineCount ||
      options.collapsedContextThreshold !==
        previous.collapsedContextThreshold ||
      options.hunkSeparators !== previous.hunkSeparators ||
      options.lineDiffType !== previous.lineDiffType ||
      options.maxLineDiffLength !== previous.maxLineDiffLength ||
      options.canHydrateContext !== previous.canHydrateContext
    ) {
      this.invalidateLines();
    }
    this.options = options;
  }

  /** Lines whose text or tokens changed; the next layout rebuilds their rows. */
  markLines(lines: Iterable<number>): void {
    const marked = (this.#marked ??= new Set());
    for (const line of lines) {
      marked.add(line);
    }
  }

  /** Drops the rows kept for lines an edit removed. */
  forgetLines(ids: readonly number[]): void {
    this.#cells.forgetLines(ids);
    for (const id of ids) {
      this.#lineRows.delete(`a${id}`);
    }
  }

  /**
   * After a change that moved rows: the rows of the last walk no longer
   * stand, so the next `layout` walks the window.
   */
  invalidateLines(): void {
    this.#lineRows.clear();
    this.#positions.clear();
    this.#last = undefined;
    this.#marked = undefined;
  }

  /**
   * The first and last new-file line numbers with a row in the window of
   * `input`, or undefined when no row shows one. Read off the last walk while
   * a layout of `input` would patch it rather than walk again; otherwise
   * found the way the walk finds them, without building rows.
   */
  newFileLines(
    input: DiffLayoutInput<LAnnotation>
  ): { first: number; last: number } | undefined {
    const last = this.#last;
    if (last != null && sameInputs(last.input, input)) {
      return last.result.newFileLines;
    }
    const { diffStyle, expandUnchanged, collapsedContextThreshold } =
      this.options;
    let first: number | undefined;
    let lastLine: number | undefined;
    iterateOverDiff({
      diff: input.model.diff,
      diffStyle,
      startingLine: input.renderRange.startingLine,
      totalLines: input.renderRange.totalLines,
      expandedHunks: expandUnchanged ? true : input.expandedHunks,
      collapsedContextThreshold,
      includeTrailingNewline: input.includeTrailingNewline,
      callback: ({ additionLine }) => {
        if (additionLine != null) {
          first ??= additionLine.lineNumber;
          lastLine = additionLine.lineNumber;
        }
      },
    });
    return first == null || lastLine == null
      ? undefined
      : { first, last: lastLine };
  }

  layout(input: DiffLayoutInput<LAnnotation>): DiffLayoutResult {
    const marked = this.#marked;
    this.#marked = undefined;
    const last = this.#last;
    if (marked != null && last != null && sameInputs(last.input, input)) {
      return this.#patch(last, marked, input);
    }
    const {
      host,
      model,
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
    this.#lineRows.clear();
    this.#positions.clear();

    const columns = {
      unified: createColumn(),
      deletions: createColumn(),
      additions: createColumn(),
    };
    const hunkData: HunkData[] = [];
    let rowCount = 0;
    let firstNewFileLine: number | undefined;
    let lastNewFileLine: number | undefined;
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
        if (additionLine != null) {
          firstNewFileLine ??= additionLine.lineNumber;
          lastNewFileLine = additionLine.lineNumber;
        }
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

        // A changed line's row gets word diff marks against its pair, which
        // the row looks up through the model when it is built. The type
        // alone decides, not whether both sides are in hand here: in unified
        // view the two sides of a pair arrive as separate rows.
        const marked = marks && type === 'change';

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
          const lineIndexText = `${unifiedLineIndex},${splitLineIndex}`;
          // A unified row shows the new line when there is one.
          this.#pushLineRow(
            input,
            columns.unified,
            additionLine != null
              ? {
                  column: 'unified',
                  key: lineKey,
                  side: 'additions',
                  lineIndex: additionLine.lineIndex,
                  marked,
                  contentProperties: decoration.contentProperties,
                  lineNumber: additionLine.lineNumber,
                  altLineNumber:
                    type === 'change' ? undefined : deletionLine?.lineNumber,
                  lineIndexText,
                  gutterLineType: decoration.gutterLineType,
                  gutterProperties: decoration.gutterProperties,
                }
              : {
                  column: 'unified',
                  key: lineKey,
                  side: 'deletions',
                  lineIndex: deletionLine.lineIndex,
                  marked,
                  contentProperties: {
                    ...decoration.contentProperties,
                    contenteditable: 'false',
                  },
                  lineNumber: deletionLine.lineNumber,
                  altLineNumber: undefined,
                  lineIndexText,
                  gutterLineType: decoration.gutterLineType,
                  gutterProperties: decoration.gutterProperties,
                }
          );
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
            this.#pushLineRow(input, columns.deletions, {
              column: 'deletions',
              key: deletionsKey,
              side: 'deletions',
              lineIndex: deletionLine.lineIndex,
              marked,
              contentProperties: deletionDecoration.contentProperties,
              lineNumber: deletionLine.lineNumber,
              altLineNumber:
                type === 'change' ? undefined : additionLine?.lineNumber,
              lineIndexText: `${deletionLine.unifiedLineIndex},${splitLineIndex}`,
              gutterLineType: deletionDecoration.gutterLineType,
              gutterProperties: deletionDecoration.gutterProperties,
            });
          }
          if (additionLine != null) {
            this.#pushLineRow(input, columns.additions, {
              column: 'additions',
              key: additionsKey,
              side: 'additions',
              lineIndex: additionLine.lineIndex,
              marked,
              contentProperties: additionDecoration.contentProperties,
              lineNumber: additionLine.lineNumber,
              altLineNumber:
                type === 'change' ? undefined : deletionLine?.lineNumber,
              lineIndexText: `${additionLine.unifiedLineIndex},${splitLineIndex}`,
              gutterLineType: additionDecoration.gutterLineType,
              gutterProperties: additionDecoration.gutterProperties,
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
    const result: DiffLayoutResult = {
      columns: {
        unified: unified && hasContent ? columns.unified.specs : undefined,
        deletions:
          includeDeletions && hasContent ? columns.deletions.specs : undefined,
        additions:
          includeAdditions && hasContent ? columns.additions.specs : undefined,
      },
      newFileLines:
        firstNewFileLine == null || lastNewFileLine == null
          ? undefined
          : { first: firstNewFileLine, last: lastNewFileLine },
      patched: undefined,
      hunkData,
      rowCount,
      totalLines,
    };
    this.#last = { input, result };
    return result;
  }

  // Builds the marked lines' rows, and their pairs', again by the same code
  // as a walk, and puts them in the last result's columns in place of the
  // rows they replace. A line without a row on screen has nothing to rebuild.
  #patch(
    last: LastLayout<LAnnotation>,
    marked: ReadonlySet<number>,
    input: DiffLayoutInput<LAnnotation>
  ): DiffLayoutResult {
    const { model } = input;
    const columns: LayoutColumns = { ...last.result.columns };
    const copied = new Set<keyof LayoutColumns>();
    // Every column laid out gets its list, so a column with no rebuilt row
    // still reads as patched and is not walked.
    const patched: LayoutColumns = {
      unified: columns.unified == null ? undefined : [],
      deletions: columns.deletions == null ? undefined : [],
      additions: columns.additions == null ? undefined : [],
    };
    const seen = new Set<LineKey>();
    const rebuild = (key: LineKey) => {
      const row = this.#lineRows.get(key);
      const position = this.#positions.get(key);
      if (row == null || position == null || seen.has(key)) {
        return;
      }
      seen.add(key);
      let target = columns[row.column];
      if (target == null) {
        throw new Error(
          'DiffLayout: a kept row is in a column that was not laid out'
        );
      }
      if (!copied.has(row.column)) {
        target = target.slice();
        columns[row.column] = target;
        copied.add(row.column);
      }
      const spec = this.#lineRow(input, row);
      target[position] = spec;
      patched[row.column]?.push(spec);
    };
    for (const line of marked) {
      if (line < 0 || line >= model.lineCount) {
        continue;
      }
      // Either side of the pair may be the one on screen; `rebuild` skips a
      // key without a row.
      rebuild(`a${model.lineId(line)}`);
      const partner = model.pairFor('additions', line);
      if (partner != null) {
        rebuild(`d${partner}`);
      }
    }
    const result = { ...last.result, columns, patched };
    this.#last = { input, result };
    return result;
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
  // Builds a line's row and keeps what it was built from.
  #pushLineRow(
    input: DiffLayoutInput<LAnnotation>,
    column: Column,
    row: LineRowInputs
  ): void {
    this.#lineRows.set(row.key, row);
    this.#positions.set(row.key, column.specs.length);
    pushRow(column, this.#lineRow(input, row));
  }

  // A line's row: its base row from the row source, marked with its pair's
  // ranges, stamped with its line attributes, with the gutter cell beside it.
  #lineRow(
    { model, rows }: DiffLayoutInput<LAnnotation>,
    row: LineRowInputs
  ): RowSpec {
    const base =
      row.side === 'additions'
        ? rows.additionRow(model, row.lineIndex)
        : rows.deletionRow(model, row.lineIndex);
    const ranges = row.marked
      ? this.#rangesFor(model, row.side, row.lineIndex)
      : NO_RANGES;
    const content = this.#line(
      base,
      ranges,
      row.contentProperties,
      row.lineNumber,
      row.altLineNumber,
      row.lineIndexText
    );
    return {
      key: row.key,
      gutter: this.#cells.gutter(
        row.key,
        row.gutterLineType,
        row.lineNumber,
        row.lineIndexText,
        row.gutterProperties
      ),
      content,
    };
  }

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
      const cached = this.#markedRows.get(base);
      if (cached != null && areRangesEqual(cached.ranges, ranges)) {
        marked = cached.row;
      } else {
        marked = markRow(base, ranges);
        this.#markedRows.set(base, { ranges, row: marked });
      }
    }
    return this.#cells.line(
      marked,
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
