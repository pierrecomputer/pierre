import type { FileModel } from '../model/FileModel';
import type { RowSource } from '../rows/RowSource';
import type { AnnotationSpan, LineAnnotation, RenderRange } from '../types';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { createAnnotationElement } from '../utils/createAnnotationElement';
import { createGutterGap } from '../utils/hast_utils';
import {
  FILE_ANNOTATION_HUNK_INDEX,
  FILE_ANNOTATION_LINE_INDEX,
  getFileAnnotations,
  shouldRenderFileAnnotations,
} from '../utils/includesFileAnnotations';
import { createColumn, pushRow, readOnly, RowCells } from './RowCells';
import type { LineKey, RowSpec } from './RowSpec';

export interface FileLayoutInput<LAnnotation> {
  model: FileModel;
  rows: RowSource;
  renderRange: RenderRange;
  /** Annotations by line number; line 0 holds the file-level ones. */
  annotations: Record<number, LineAnnotation<LAnnotation>[] | undefined>;
  annotationSlotName(annotation: LineAnnotation<LAnnotation>): string;
}

export interface FileLayoutResult {
  /** The one column a file renders: a gutter cell and a content cell per row. */
  column: RowSpec[];
  /**
   * The rows that differ from the last layout, when lines marked by an edit
   * were the only change since it; undefined when the window was walked.
   */
  patched: RowSpec[] | undefined;
  rowCount: number;
  totalLines: number;
}

// The last walk: what it read, what it built, and where each line's row sits
// in the column, so marked lines can be rebuilt into it without a walk.
interface LastLayout<LAnnotation> {
  input: FileLayoutInput<LAnnotation>;
  result: FileLayoutResult;
  positions: Map<LineKey, number>;
}

// Whether a walk over `next` would read the same things as the walk over
// `last` did, apart from the lines' text, which the marks account for.
function sameInputs<LAnnotation>(
  last: FileLayoutInput<LAnnotation>,
  next: FileLayoutInput<LAnnotation>
): boolean {
  return (
    last.model === next.model &&
    last.rows === next.rows &&
    last.annotations === next.annotations &&
    last.annotationSlotName === next.annotationSlotName &&
    areRenderRangesEqual(last.renderRange, next.renderRange)
  );
}

/**
 * Places the rows of a plain file for one render: the file-level annotation
 * row, then one row per line in the render range with its line number, each
 * followed by its annotation row. One column, no marks. Rows are memoized on
 * their inputs, so a row that did not change is the same object as last
 * time. When an edit marked lines and nothing else changed since the last
 * walk, the layout rebuilds those lines' rows into the last result instead
 * of walking the window again.
 */
export class FileLayout<LAnnotation = undefined> {
  readonly #cells = new RowCells();
  #last: LastLayout<LAnnotation> | undefined;
  // Lines whose text or tokens changed since the last walk.
  #marked: Set<number> | undefined;

  /** Lines whose text or tokens changed; the next layout rebuilds their rows. */
  markLines(lines: Iterable<number>): void {
    const marked = (this.#marked ??= new Set());
    for (const line of lines) {
      marked.add(line);
    }
  }

  layout(input: FileLayoutInput<LAnnotation>): FileLayoutResult {
    const marked = this.#marked;
    this.#marked = undefined;
    const last = this.#last;
    if (marked != null && last != null && sameInputs(last.input, input)) {
      return this.#patch(last, marked, input);
    }
    const { model, renderRange, annotations } = input;
    const column = createColumn();
    const positions = new Map<LineKey, number>();
    let rowCount = 0;
    const names = (list: LineAnnotation<LAnnotation>[]) =>
      list.map((annotation) => input.annotationSlotName(annotation));
    const pushAnnotationRow = (
      lineKey: LineKey | 'file',
      span: AnnotationSpan
    ) => {
      this.#cells.fixedRow(
        column,
        `ann:${lineKey}`,
        `context|${span.hunkIndex},${span.lineIndex}|${span.annotations.join(',')}`,
        () => ({
          gutter: createGutterGap('context', 'annotation', 1),
          content: readOnly(createAnnotationElement(span)),
        })
      );
      rowCount++;
    };

    const fileAnnotations = shouldRenderFileAnnotations(renderRange)
      ? getFileAnnotations(annotations)
      : undefined;
    if (fileAnnotations != null) {
      pushAnnotationRow('file', {
        type: 'annotation',
        hunkIndex: FILE_ANNOTATION_HUNK_INDEX,
        lineIndex: FILE_ANNOTATION_LINE_INDEX,
        annotations: names(fileAnnotations),
      });
    }

    const totalLines = model.lineCount;
    const end = Math.min(
      renderRange.startingLine + renderRange.totalLines,
      totalLines
    );
    for (let line = renderRange.startingLine; line < end; line++) {
      const lineNumber = line + 1;
      const key: LineKey = `a${model.lineId(line)}`;
      positions.set(key, column.specs.length);
      pushRow(column, this.#lineRow(input, line, key));
      rowCount++;
      const lineAnnotations = annotations[lineNumber];
      if (lineAnnotations != null && lineAnnotations.length > 0) {
        pushAnnotationRow(key, {
          type: 'annotation',
          hunkIndex: 0,
          lineIndex: lineNumber,
          annotations: names(lineAnnotations),
        });
      }
    }
    const result = {
      column: column.specs,
      patched: undefined,
      rowCount,
      totalLines,
    };
    this.#last = { input, result, positions };
    return result;
  }

  // Builds the marked lines' rows again, by the same code as a walk, and
  // puts them in the last result's column in place of the rows they replace.
  // A line without a row on screen has nothing to rebuild.
  #patch(
    last: LastLayout<LAnnotation>,
    marked: ReadonlySet<number>,
    input: FileLayoutInput<LAnnotation>
  ): FileLayoutResult {
    const { model } = input;
    const column = last.result.column.slice();
    const patched: RowSpec[] = [];
    for (const line of marked) {
      if (line < 0 || line >= model.lineCount) {
        continue;
      }
      const key: LineKey = `a${model.lineId(line)}`;
      const position = last.positions.get(key);
      if (position == null) {
        continue;
      }
      const spec = this.#lineRow(input, line, key);
      column[position] = spec;
      patched.push(spec);
    }
    const result = { ...last.result, column, patched };
    this.#last = { input, result, positions: last.positions };
    return result;
  }

  // A line's row: its base row from the row source, stamped with its line
  // attributes, with the gutter cell beside it.
  #lineRow(
    { model, rows }: FileLayoutInput<LAnnotation>,
    line: number,
    key: LineKey
  ): RowSpec {
    const lineNumber = line + 1;
    const lineIndexText = `${line}`;
    const base = rows.additionRow(model, line);
    const content = this.#cells.line(
      base,
      { 'data-line-type': 'context' },
      lineNumber,
      undefined,
      lineIndexText
    );
    return {
      key,
      gutter: this.#cells.gutter(key, 'context', lineNumber, lineIndexText),
      content,
    };
  }

  /** Drops the rows kept for lines an edit removed. */
  forgetLines(ids: readonly number[]): void {
    this.#cells.forgetLines(ids);
  }

  /**
   * After a change that moved rows: the rows of the last walk no longer
   * stand, so the next `layout` walks the window.
   */
  invalidateLines(): void {
    this.#last = undefined;
    this.#marked = undefined;
  }
}
