import type { ElementContent, Element as HASTElement, Properties } from 'hast';

import type { LineDiffRange } from './computeLineDiffRanges';
import {
  DecoratedLineBuilder,
  type LineDecoration,
} from './DecoratedLineBuilder';
import { wrapTokenFragments } from './wrapTokenFragments';

/**
 * Returns a copy of a rendered code row where the highlighted changed text
 * (the `data-diff-span` spans) covers exactly `ranges`. Existing highlights
 * are removed first. The input row is never modified, and it is returned as
 * is when there is nothing to change.
 *
 * The row must be a diff row as this package renders it: token spans,
 * optionally grouped by `data-char` and wrapped in highlights. Highlights
 * never overlap, so any other wrapper span, including the ones overlapping
 * highlights would create, throws. Empty rows never have highlights, so
 * giving one ranges, or passing one that has highlights, throws too.
 *
 * When old highlights split a token's styled span, the pieces are joined back
 * using the token's `data-char` attribute, which rows rendered for the editor
 * have. On rows without it, those pieces stay split. The row looks the same,
 * but it won't exactly match a fresh render. Plain text is not affected.
 */
export function applyLineDiffMarks(
  row: HASTElement,
  ranges: readonly LineDiffRange[]
): HASTElement {
  if (ranges.length === 0 && !hasDiffSpan(row)) {
    return row;
  }
  const pieces: TextPiece[] = [];
  collectTextPieces(row.children, undefined, pieces);
  if (pieces.length === 0) {
    throw new Error(
      'applyLineDiffMarks: empty rows never have highlights to add or remove'
    );
  }
  const line: HASTElement = {
    type: 'element',
    tagName: row.tagName,
    properties: { ...row.properties },
    children: [],
  };
  const spans: LineDecoration[] = ranges.map(([start, end]) => ({
    start: { line: 0, character: start },
    end: { line: 0, character: end },
    properties: { 'data-diff-span': '' },
    alwaysWrap: true,
  }));
  let lineLength = 0;
  for (const piece of pieces) lineLength += piece.text.length;
  const builder = new DecoratedLineBuilder(line, spans, 0, lineLength);
  let column = 0;
  for (const piece of pieces) {
    const { text } = piece;
    const start = column;
    const end = start + text.length;
    while (column < end) {
      builder.moveTo(column);
      const to = Math.min(end, builder.nextEdge);
      builder.parent.children.push(
        createPieceNode(
          piece,
          column === start && to === end
            ? text
            : text.slice(column - start, to - start)
        )
      );
      column = to;
    }
  }
  builder.moveTo(column);
  if (pieces.some((piece) => piece.char != null)) {
    wrapTokenFragments(line);
  }
  return line;
}

// A piece of a row's text and how it was rendered. With `properties` it is a
// <span> with those attributes; without them it is plain text. `char` is the
// column where its token starts, which the editor reads from `data-char`.
interface TextPiece {
  text: string;
  properties: Properties | undefined;
  char: number | undefined;
}

// Creates the node for `text`, which is all or part of `piece`.
function createPieceNode(piece: TextPiece, text: string): ElementContent {
  if (piece.properties == null) {
    return { type: 'text', value: text };
  }
  // Each span gets its own attributes object, because later steps edit it.
  const properties: Properties = { ...piece.properties };
  if (piece.char != null) properties['data-char'] = piece.char;
  return {
    type: 'element',
    tagName: 'span',
    properties,
    children: [{ type: 'text', value: text }],
  };
}

function hasDiffSpan(node: HASTElement): boolean {
  for (const child of node.children) {
    if (child.type !== 'element') continue;
    if (child.properties['data-diff-span'] != null || hasDiffSpan(child)) {
      return true;
    }
  }
  return false;
}

// Turns a row back into a flat list of text pieces with their styles. Drops
// the highlight spans and the spans that group one token's pieces together.
function collectTextPieces(
  children: ElementContent[],
  inheritedChar: number | undefined,
  pieces: TextPiece[]
): void {
  for (const child of children) {
    if (child.type === 'text') {
      // An empty row contains a single newline, which is not part of the
      // line's text.
      if (inheritedChar == null && child.value === '\n') continue;
      pushTextPiece(pieces, {
        text: child.value,
        properties: undefined,
        char: inheritedChar,
      });
      continue;
    }
    if (child.type !== 'element') continue;
    if (child.tagName === 'br') continue;
    if (child.tagName !== 'span') {
      throw new Error(
        `applyLineDiffMarks: unexpected <${child.tagName}> in a code row`
      );
    }
    const char = getChar(child.properties) ?? inheritedChar;
    if (child.properties['data-diff-span'] != null) {
      collectTextPieces(child.children, char, pieces);
      continue;
    }
    if (child.children.some((node) => node.type !== 'text')) {
      if (!isTokenGroup(child)) {
        throw new Error(
          'applyLineDiffMarks: unexpected wrapper span in a code row. Overlapping highlights are not supported.'
        );
      }
      collectTextPieces(child.children, char, pieces);
      continue;
    }
    const properties: Properties = { ...child.properties };
    delete properties['data-char'];
    let text = '';
    for (const node of child.children) {
      if (node.type === 'text') text += node.value;
    }
    pushTextPiece(pieces, { text, properties, char });
  }
}

// Whether a span only groups the pieces of one token: it has a `data-char`
// and no other attributes.
function isTokenGroup(span: HASTElement): boolean {
  if (getChar(span.properties) == null) return false;
  for (const name in span.properties) {
    if (name !== 'data-char' && span.properties[name] != null) return false;
  }
  return true;
}

// Adds a text piece to the list. If it came from the same token as the
// previous piece, the two are joined, so the edges of old highlights go away.
function pushTextPiece(pieces: TextPiece[], piece: TextPiece): void {
  const last = pieces.at(-1);
  if (
    last != null &&
    last.char === piece.char &&
    (piece.char != null ||
      (last.properties == null && piece.properties == null))
  ) {
    last.text += piece.text;
    return;
  }
  pieces.push(piece);
}

function getChar(properties: Properties): number | undefined {
  const value = properties['data-char'];
  return typeof value === 'number' ? value : undefined;
}
