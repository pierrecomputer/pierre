import type { Element as HASTElement, Properties } from 'hast';

import type { LineTypes } from '../types';
import { createGutterItem } from '../utils/hast_utils';
import type { LineKey, RowKey, RowSpec } from './RowSpec';

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
export interface Column {
  specs: RowSpec[];
  lastKey: RowKey | undefined;
}

/**
 * Builds the gutter and content cells of rows, and caches them. A cell built
 * from the same inputs as last render is returned as the same object, which
 * is how the reconciler knows it can leave the row's DOM alone.
 */
export class RowCells {
  // Content cells by the highlight row they stamp, reused while the line
  // attributes match.
  readonly #stamped = new WeakMap<HASTElement, StampedRow>();
  // Gutter cells by line key, reused while the line number, type and
  // decoration match, so a line whose text changed keeps its gutter cell.
  readonly #gutters = new Map<LineKey, GutterCell>();
  // Kept by key while their signature matches.
  readonly #fixedRows = new Map<RowKey, FixedRow>();

  /**
   * The content cell of a line: `row` with its line attributes. Reuses the
   * last cell while the attributes match.
   */
  line(
    row: HASTElement,
    contentProperties: Properties | undefined,
    lineNumber: number,
    altLineNumber: number | undefined,
    lineIndexText: string
  ): HASTElement {
    // Line attributes in one order for every row, whichever source built it.
    const properties: Properties = {
      ...row.properties,
      'data-line': lineNumber,
      'data-alt-line': altLineNumber,
      'data-line-type':
        contentProperties?.['data-line-type'] ??
        row.properties['data-line-type'],
      'data-line-index': lineIndexText,
      ...contentProperties,
    };
    const cached = this.#stamped.get(row);
    if (cached != null && arePropertiesEqual(cached.properties, properties)) {
      return cached.row;
    }
    const stamped: HASTElement = { ...row, properties };
    this.#stamped.set(row, { properties, row: stamped });
    return stamped;
  }

  /**
   * The gutter cell of the line with `key`, reused while its number, type
   * and properties match, whatever happened to the line's text.
   */
  gutter(
    key: LineKey,
    lineType: LineTypes,
    lineNumber: number,
    lineIndexText: string,
    properties: Properties = {}
  ): HASTElement {
    const cached = this.#gutters.get(key);
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
    this.#gutters.set(key, {
      lineType,
      lineNumber,
      lineIndexText,
      properties,
      cell,
    });
    return cell;
  }

  /** Pushes a row that is not built from a line, reusing it while its signature matches. */
  fixedRow(
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

  /**
   * Drops the rows kept for lines an edit removed: their gutter cells, their
   * annotation rows and the buffers that followed them.
   */
  forgetLines(ids: readonly number[]): void {
    for (const id of ids) {
      this.#gutters.delete(`a${id}`);
      this.#fixedRows.delete(`ann:a${id}`);
      this.#fixedRows.delete(`buf:a${id}`);
      this.#fixedRows.delete(`buf:ann:a${id}`);
    }
  }
}

export function createColumn(): Column {
  return { specs: [], lastKey: undefined };
}

export function pushRow(column: Column, spec: RowSpec): void {
  column.specs.push(spec);
  column.lastKey = spec.key;
}

// Content cells that are not document lines, such as annotation rows and
// separators, are never editable, so the caret cannot enter them while the
// column is. Added on every render so attaching an editor changes no rows.
export function readOnly(cell: HASTElement): HASTElement {
  return {
    ...cell,
    properties: { ...cell.properties, contenteditable: 'false' },
  };
}

function arePropertiesEqual(a: Properties, b: Properties): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
