import type { Element } from 'hast';

import type { DecorationItem } from '../types';

/** A decoration whose start and end are given as a line and a column. */
export interface LineDecoration extends Omit<DecorationItem, 'start' | 'end'> {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

// A decoration's start and end column on this line. When decorations
// overlap, `order` decides which wrapper goes on the outside.
interface LineDecorationRange {
  decoration: LineDecoration;
  order: number;
  from: number;
  to: number;
}

interface DecorationBoundary {
  position: number;
  range: LineDecorationRange;
  start: boolean;
}

/**
 * Builds the children of one line element and wraps each decorated range in
 * a <span> with that decoration's attributes.
 *
 * Add the line's text from left to right. Before adding text at a column,
 * call `moveTo(column)`, then add the text to `parent`. Text must be split at
 * `nextEdge`. After the last text, call `moveTo` with the line length.
 */
export class DecoratedLineBuilder {
  /** The element that text at the current column should be added to. */
  parent: Element;
  /**
   * The column where the next decoration starts or ends, or the line length
   * when there are no more. It is never Infinity, because that makes the
   * callers' text loops noticeably slower.
   */
  nextEdge: number;

  #line: Element;
  #lineLength: number;
  #boundaries: DecorationBoundary[] = [];
  #boundaryIndex = 0;
  #active: LineDecorationRange[] = [];
  #stack: { range: LineDecorationRange; node: Element }[] = [];

  constructor(
    line: Element,
    spans: LineDecoration[],
    lineIndex: number,
    lineLength: number
  ) {
    this.parent = this.#line = line;
    this.#lineLength = lineLength;
    // Sort so a decoration that starts earlier, or is longer, wraps around the
    // ones inside it.
    if (spans.length > 1)
      spans.sort((a, b) => {
        if (a.start.line !== b.start.line) return a.start.line - b.start.line;
        if (a.start.character !== b.start.character)
          return a.start.character - b.start.character;
        if (a.end.line !== b.end.line) return b.end.line - a.end.line;
        return b.end.character - a.end.character;
      });
    const boundaries = this.#boundaries;
    for (let order = 0; order < spans.length; order++) {
      const decoration = spans[order];
      const range: LineDecorationRange = {
        decoration,
        order,
        from:
          decoration.start.line === lineIndex ? decoration.start.character : 0,
        to:
          decoration.end.line === lineIndex
            ? decoration.end.character
            : lineLength,
      };
      boundaries.push(
        {
          position: Math.max(0, Math.min(range.from, lineLength)),
          range,
          start: true,
        },
        {
          position: Math.max(0, Math.min(range.to, lineLength)),
          range,
          start: false,
        }
      );
    }
    boundaries.sort((a, b) => a.position - b.position);
    this.nextEdge = boundaries[0]?.position ?? lineLength;
  }

  /** Opens and closes decorations for text that starts at `column`. */
  moveTo(column: number): void {
    if (
      this.nextEdge === column &&
      this.#boundaryIndex < this.#boundaries.length
    )
      this.#advance(column);
  }

  // An empty decoration (start equals end) goes inside the decoration that
  // starts at the same column. At the end of the line, it goes inside the
  // one that ends there.
  #advance(position: number): void {
    const boundaries = this.#boundaries;
    const lineLength = this.#lineLength;
    const first = this.#boundaryIndex;
    let boundaryIndex = first;
    while (boundaries[boundaryIndex]?.position === position) boundaryIndex++;
    this.#boundaryIndex = boundaryIndex;
    this.nextEdge = boundaries[boundaryIndex]?.position ?? this.#lineLength;
    let hasMarker = false;
    for (let i = first; i < boundaryIndex; i++) {
      const { range, start } = boundaries[i];
      if (!start && range.from !== range.to && position < lineLength)
        this.#updateActive(range, false);
    }
    for (let i = first; i < boundaryIndex; i++) {
      const { range, start } = boundaries[i];
      if (
        start &&
        range.from <= position &&
        range.to >= position &&
        (range.to > position ||
          range.from === position ||
          position === lineLength)
      ) {
        this.#updateActive(range, true);
        if (range.from === range.to) hasMarker = true;
      }
    }
    if (hasMarker) {
      this.#getParent();
      for (let i = first; i < boundaryIndex; i++) {
        const { range, start } = boundaries[i];
        if (start && range.from === range.to) this.#updateActive(range, false);
      }
    }
    if (position < lineLength) this.parent = this.#getParent();
  }

  // Keep the open decorations sorted, so overlapping ones always nest the
  // same way.
  #updateActive(range: LineDecorationRange, add: boolean): void {
    const active = this.#active;
    let low = 0;
    let high = active.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (active[middle].order < range.order) low = middle + 1;
      else high = middle;
    }
    if (add) active.splice(low, 0, range);
    else if (active[low] === range) active.splice(low, 1);
  }

  // Reuse an open wrapper so one continuous range stays in one element.
  #getParent(): Element {
    const stack = this.#stack;
    let parent = this.#line;
    let depth = 0;
    for (const range of this.#active) {
      if (stack[depth]?.range !== range) {
        stack.length = depth;
        const wrapper: Element = {
          type: 'element',
          tagName: 'span',
          properties: { ...range.decoration.properties },
          children: [],
        };
        parent.children.push(wrapper);
        stack.push({ range, node: wrapper });
      }
      parent = stack[depth++].node;
    }
    stack.length = depth;
    return parent;
  }
}
