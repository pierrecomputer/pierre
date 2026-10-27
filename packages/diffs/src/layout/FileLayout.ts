import type { FileModel } from '../model/FileModel';
import type { RowSource } from '../rows/RowSource';
import type { AnnotationSpan, LineAnnotation, RenderRange } from '../types';
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
  rowCount: number;
  totalLines: number;
}

/**
 * Places the rows of a plain file for one render: the file-level annotation
 * row, then one row per line in the render range with its line number, each
 * followed by its annotation row. One column, no marks. Rows are memoized on
 * their inputs, so a row that did not change is the same object as last
 * time.
 */
export class FileLayout<LAnnotation = undefined> {
  readonly #cells = new RowCells();

  layout(input: FileLayoutInput<LAnnotation>): FileLayoutResult {
    const { model, rows, renderRange, annotations } = input;
    const column = createColumn();
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
      const lineIndexText = `${line}`;
      const key: LineKey = `a${model.lineId(line)}`;
      const base = rows.additionRow(model, line);
      const content = this.#cells.line(
        base,
        base,
        { 'data-line-type': 'context' },
        lineNumber,
        undefined,
        lineIndexText
      );
      pushRow(column, {
        key,
        gutter: this.#cells.gutter(
          content,
          'context',
          lineNumber,
          lineIndexText
        ),
        content,
      });
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
    return { column: column.specs, rowCount, totalLines };
  }

  /** Drops the rows kept for lines an edit removed. */
  forgetLines(ids: readonly number[]): void {
    this.#cells.forgetLines(ids);
  }
}
