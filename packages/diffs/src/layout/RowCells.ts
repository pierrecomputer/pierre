import type { Element as HASTElement, Properties } from 'hast';

import { i18n } from '../i18n/I18n';
import type { LineTypes } from '../types';
import { createGutterItem } from '../utils/hast_utils';
import type { LineKey, RowKey, RowSpec } from './RowSpec';

// A content cell, and the line attributes it was built with.
interface StampedRow {
  contentProperties: Properties | undefined;
  lineNumber: number;
  altLineNumber: number | undefined;
  lineIndexText: string;
  readOnly: boolean;
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
  // Separators and "no newline" markers carry translated text, so a row
  // built under an older set of messages is rebuilt.
  messagesVersion: number;
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
   * last cell while the attributes match. `readOnly` marks a line the caret
   * must not enter.
   */
  line(
    row: HASTElement,
    contentProperties: Properties | undefined,
    lineNumber: number,
    altLineNumber: number | undefined,
    lineIndexText: string,
    readOnly = false
  ): HASTElement {
    const cached = this.#stamped.get(row);
    if (
      cached != null &&
      cached.lineNumber === lineNumber &&
      cached.altLineNumber === altLineNumber &&
      cached.lineIndexText === lineIndexText &&
      cached.readOnly === readOnly &&
      arePropertiesEqual(cached.contentProperties, contentProperties)
    ) {
      return cached.row;
    }
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
    if (readOnly) {
      properties.contenteditable = 'false';
    }
    const stamped: HASTElement = { ...row, properties };
    this.#stamped.set(row, {
      contentProperties,
      lineNumber,
      altLineNumber,
      lineIndexText,
      readOnly,
      row: stamped,
    });
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
    const messagesVersion = i18n.version;
    if (
      fixed == null ||
      fixed.signature !== signature ||
      fixed.messagesVersion !== messagesVersion
    ) {
      fixed = { signature, messagesVersion, ...create() };
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

// Whether two sets of properties hold the same names and values.
function arePropertiesEqual(
  a: Properties | undefined,
  b: Properties | undefined
): boolean {
  if (a === b) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  let count = 0;
  for (const key in a) {
    if (a[key] !== b[key]) {
      return false;
    }
    count++;
  }
  for (const _key in b) {
    count--;
  }
  return count === 0;
}
