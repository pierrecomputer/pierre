import type { ElementContent, Element as HASTElement, Properties } from 'hast';

import type { LineDiffRange } from '../utils/computeLineDiffRanges';
import {
  DecoratedLineBuilder,
  type LineDecoration,
} from '../utils/DecoratedLineBuilder';
import { wrapTokenFragments } from '../utils/wrapTokenFragments';

/**
 * Returns a copy of a base row with the changed text in `ranges` wrapped in
 * `data-diff-span` spans. The base row is never changed, and it is returned
 * as is when there is nothing to mark.
 *
 * A base row has no marks yet: its children are token spans (optionally with
 * `data-char`), plain text, or the single `<br>` or newline of an empty row.
 * Anything else is a row this package did not build, and throws.
 */
export function markRow(
  row: HASTElement,
  ranges: readonly LineDiffRange[]
): HASTElement {
  if (ranges.length === 0) {
    return row;
  }
  const pieces: TextPiece[] = [];
  collectTextPieces(row.children, pieces);
  if (pieces.length === 0) {
    throw new Error('markRow: an empty row has no text to mark');
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

// Turns a base row into a flat list of text pieces with their styles.
function collectTextPieces(
  children: ElementContent[],
  pieces: TextPiece[]
): void {
  for (const child of children) {
    if (child.type === 'text') {
      // An empty row holds a single newline that is not part of its text.
      if (child.value === '\n' && children.length === 1) continue;
      pieces.push({
        text: child.value,
        properties: undefined,
        char: undefined,
      });
      continue;
    }
    if (child.type !== 'element') continue;
    if (child.tagName === 'br') continue;
    if (child.tagName !== 'span') {
      throw new Error(`markRow: unexpected <${child.tagName}> in a base row`);
    }
    if (
      child.properties['data-diff-span'] != null ||
      child.children.some((node) => node.type !== 'text')
    ) {
      throw new Error('markRow: a base row has no wrapper spans');
    }
    const properties: Properties = { ...child.properties };
    const char = properties['data-char'];
    delete properties['data-char'];
    let text = '';
    for (const node of child.children) {
      if (node.type === 'text') text += node.value;
    }
    pieces.push({
      text,
      properties,
      char: typeof char === 'number' ? char : undefined,
    });
  }
}
