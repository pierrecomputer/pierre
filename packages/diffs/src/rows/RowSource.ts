import type { ElementContent, Element as HASTElement } from 'hast';

import type { DiffModel } from '../model/DiffModel';
import type { HighlightedToken } from '../types';
import { cleanLastNewline } from '../utils/cleanLastNewline';

export interface RowSourceOptions {
  /** Old-file rows from the highlight result, by old line index, unmarked. */
  deletionRows: readonly ElementContent[];
  /**
   * New-file rows from the highlight result, by the line index each had when
   * the session started, unmarked. For a static model these are the rows.
   */
  originalAdditionRows: readonly ElementContent[];
  /** The new-file lines those rows were rendered from. */
  originalAdditionLines: readonly string[];
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
  readonly #deletionRows: readonly ElementContent[];
  readonly #originalAdditionRows: readonly ElementContent[];
  readonly #originalAdditionLines: readonly string[];
  // Editor tokens by line id with the text they spell, and the row built
  // from each tokens array.
  readonly #tokens = new Map<
    number,
    { tokens: HighlightedToken[]; text: string }
  >();
  readonly #tokenRows = new WeakMap<HighlightedToken[], HASTElement>();
  readonly #plainRows = new Map<number, { text: string; row: HASTElement }>();

  constructor({
    deletionRows,
    originalAdditionRows,
    originalAdditionLines,
  }: RowSourceOptions) {
    this.#deletionRows = deletionRows;
    this.#originalAdditionRows = originalAdditionRows;
    this.#originalAdditionLines = originalAdditionLines;
  }

  /**
   * Records the editor's tokens for a line. Returns false when they render
   * the same as the tokens already held, so callers can skip the row.
   */
  setTokens(lineId: number, tokens: HighlightedToken[]): boolean {
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
  hasTokens(lineId: number): boolean {
    return this.#tokens.has(lineId);
  }

  deletionRow(lineIndex: number): HASTElement | undefined {
    const row = this.#deletionRows[lineIndex];
    return row?.type === 'element' ? row : undefined;
  }

  additionRow(model: DiffModel, lineIndex: number): HASTElement {
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
    const originalIndex = model.originalLineIndex(lineIndex);
    if (originalIndex >= 0) {
      const row = this.#originalAdditionRows[originalIndex];
      if (
        row?.type === 'element' &&
        this.#originalAdditionLines[originalIndex] === text
      ) {
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

// A row from the editor's tokens: one span per token with the column it
// starts at, which the editor reads to map carets. An empty line is a <br>.
function createTokenRow(tokens: readonly HighlightedToken[]): HASTElement {
  return {
    type: 'element',
    tagName: 'div',
    properties: {},
    children: tokens.map(([char, color, text]) => {
      if (char === 0 && color === '') {
        if (text === '') {
          return {
            type: 'element',
            tagName: 'br',
            properties: {},
            children: [],
          };
        }
        return { type: 'text', value: text };
      }
      return {
        type: 'element',
        tagName: 'span',
        properties: { 'data-char': char, style: `color:${color};` },
        children: [{ type: 'text', value: text }],
      };
    }),
  };
}

// A row for a line the editor has not tokenized yet: its text in one span,
// so the editor can still place a caret in it.
function createPlainRow(lineText: string): HASTElement {
  return {
    type: 'element',
    tagName: 'div',
    properties: {},
    children: [
      {
        type: 'element',
        tagName: 'span',
        properties: { 'data-char': 0 },
        children: [{ type: 'text', value: lineText }],
      },
    ],
  };
}
