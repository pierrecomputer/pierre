import type { ElementContent, Element as HASTElement } from 'hast';

import type { DiffModel } from '../model/DiffModel';
import type { HighlightedToken } from '../types';
import { cleanLastNewline } from '../utils/cleanLastNewline';
import { createPlainRow, createTokenRow } from '../utils/hast_utils';

export interface HighlightRows {
  /** Old-file rows from the highlight result, by old line index, unmarked. */
  deletionRows: readonly ElementContent[];
  /** New-file rows from the highlight result, by line index, unmarked. */
  additionRows: readonly ElementContent[];
  /** The new-file lines those rows were rendered from. */
  additionLines: readonly string[];
  /**
   * The id of the line each addition row was highlighted for. Given for a
   * diff being edited, so rows follow their lines through later edits.
   */
  lineIds?: readonly number[];
}

// A highlight row kept for a line, with the text it shows.
interface OriginalRow {
  row: HASTElement;
  text: string;
}

/**
 * Base rows for the rows the layout places: token spans and text, with no
 * marks and no line attributes. Deletion rows come from the highlight result.
 * Addition rows come from the editor's tokens when it has sent some for the
 * line, else from the highlight result while the line's text is unchanged,
 * else as plain text until tokens arrive. Rows are memoized on their inputs,
 * so an unchanged line gives the same object back.
 */
export class RowSource {
  #deletionRows: readonly ElementContent[] = [];
  // Highlight rows for a model that is not being edited, by line index.
  #additionRows: readonly ElementContent[] = [];
  #additionLines: readonly string[] = [];
  // Highlight rows for a model being edited, by the id of the line each was
  // rendered for, so a row follows its line through edits above it.
  #rowsById: Map<number, OriginalRow> | undefined;
  // Editor tokens by line id with the text they spell, and the row built
  // from each tokens array.
  readonly #tokens = new Map<
    number,
    { tokens: HighlightedToken[]; text: string }
  >();
  readonly #tokenRows = new WeakMap<HighlightedToken[], HASTElement>();
  readonly #plainRows = new Map<number, { text: string; row: HASTElement }>();
  // Plain rows for old lines the highlight result has no row for.
  readonly #plainDeletionRows = new Map<
    number,
    { text: string; row: HASTElement }
  >();

  constructor(rows: HighlightRows) {
    this.setHighlightRows(rows);
  }

  /** Binds the rows of a highlight result, keeping the editor's tokens. */
  public setHighlightRows({
    deletionRows,
    additionRows,
    additionLines,
    lineIds,
  }: HighlightRows): void {
    this.#deletionRows = deletionRows;
    if (lineIds != null) {
      const rowsById = new Map<number, OriginalRow>();
      for (let line = 0; line < additionLines.length; line++) {
        const row = additionRows[line];
        if (row?.type === 'element') {
          rowsById.set(lineIds[line], { row, text: additionLines[line] });
        }
      }
      this.#rowsById = rowsById;
      this.#additionRows = [];
      this.#additionLines = [];
    } else {
      this.#rowsById = undefined;
      this.#additionRows = additionRows;
      this.#additionLines = additionLines;
    }
  }

  /**
   * Records the editor's tokens for a line. Returns false when they render
   * the same as the tokens already held, so callers can skip the row.
   */
  public setTokens(lineId: number, tokens: HighlightedToken[]): boolean {
    const previous = this.#tokens.get(lineId);
    if (previous != null && areTokensEqual(previous.tokens, tokens)) {
      return false;
    }
    let text = '';
    for (const token of tokens) text += token[2];
    this.#tokens.set(lineId, { tokens, text });
    this.#plainRows.delete(lineId);
    return true;
  }

  /** Whether the editor has sent tokens for a line. */
  public hasTokens(lineId: number): boolean {
    return this.#tokens.has(lineId);
  }

  /** Drops what is held for lines an edit deleted. */
  public forgetLines(lineIds: readonly number[]): void {
    for (const lineId of lineIds) {
      this.#tokens.delete(lineId);
      this.#plainRows.delete(lineId);
      this.#rowsById?.delete(lineId);
    }
  }

  /**
   * The row for an old line. A highlight result has rows only for lines in
   * hunks, so a diff with none (a pure rename) edited into one shows its old
   * lines as plain text until it is highlighted again.
   */
  public deletionRow(model: DiffModel, lineIndex: number): HASTElement {
    const row = this.#deletionRows[lineIndex];
    if (row?.type === 'element') {
      return row;
    }
    const text = cleanLastNewline(model.diff.deletionLines[lineIndex] ?? '');
    const plain = this.#plainDeletionRows.get(lineIndex);
    if (plain != null && plain.text === text) {
      return plain.row;
    }
    const created = createPlainRow(text);
    this.#plainDeletionRows.set(lineIndex, { text, row: created });
    return created;
  }

  public additionRow(model: DiffModel, lineIndex: number): HASTElement {
    const lineId = model.lineId(lineIndex);
    const text = model.diff.additionLines[lineIndex] ?? '';
    const lineText = cleanLastNewline(text);
    // Tokens from before the latest edit to this line spell the old text, so
    // they are skipped until the editor sends new ones.
    const held = this.#tokens.get(lineId);
    if (held != null && held.text === lineText) {
      let row = this.#tokenRows.get(held.tokens);
      if (row == null) {
        row = createTokenRow(held.tokens);
        this.#tokenRows.set(held.tokens, row);
      }
      return row;
    }
    const rowsById = this.#rowsById;
    if (rowsById != null) {
      const original = rowsById.get(lineId);
      if (original != null && original.text === text) {
        return original.row;
      }
    } else {
      const row = this.#additionRows[lineIndex];
      if (row?.type === 'element' && this.#additionLines[lineIndex] === text) {
        return row;
      }
    }
    const plain = this.#plainRows.get(lineId);
    if (plain != null && plain.text === lineText) {
      return plain.row;
    }
    const row = createPlainRow(lineText);
    this.#plainRows.set(lineId, { text: lineText, row });
    return row;
  }
}

// Whether two token lists render the same row.
function areTokensEqual(
  a: readonly HighlightedToken[],
  b: readonly HighlightedToken[]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const [aChar, aColor, aText] = a[index];
    const [bChar, bColor, bText] = b[index];
    if (aChar !== bChar || aColor !== bColor || aText !== bText) return false;
  }
  return true;
}
