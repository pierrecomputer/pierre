import type { ElementContent, Element as HASTElement, Text } from 'hast';

import type { SearchLineDecoration } from '../types';
import { createHastElement, createTextNodeElement } from './hast_utils';

interface SearchDecorationRange {
  start: number;
  end: number;
  current: boolean;
}

interface DecorationContext {
  ranges: SearchDecorationRange[];
  offset: number;
  rangeIndex: number;
  changed: boolean;
}

export function applySearchDecorationsToLine(
  line: ElementContent,
  decorations: readonly SearchLineDecoration[] | undefined
): ElementContent {
  const ranges = normalizeSearchDecorationRanges(decorations);
  if (ranges.length === 0 || line.type !== 'element') {
    return line;
  }

  const context: DecorationContext = {
    ranges,
    offset: 0,
    rangeIndex: 0,
    changed: false,
  };
  const result = decorateElement(line, context);
  return context.changed ? result : line;
}

function normalizeSearchDecorationRanges(
  decorations: readonly SearchLineDecoration[] | undefined
): SearchDecorationRange[] {
  if (decorations == null || decorations.length === 0) {
    return [];
  }

  return decorations
    .filter(({ startCharacter, endCharacter }) => endCharacter > startCharacter)
    .map(({ startCharacter, endCharacter, current }) => ({
      start: startCharacter,
      end: endCharacter,
      current: current === true,
    }))
    .sort((a, b) => {
      const startDelta = a.start - b.start;
      return startDelta !== 0 ? startDelta : a.end - b.end;
    });
}

function decorateElement(
  node: HASTElement,
  context: DecorationContext
): HASTElement {
  const children: ElementContent[] = [];
  let childrenChanged = false;

  for (const child of node.children) {
    const decorated = decorateNode(child, context);
    if (Array.isArray(decorated)) {
      children.push(...decorated);
      childrenChanged = true;
    } else {
      children.push(decorated);
      childrenChanged ||= decorated !== child;
    }
  }

  if (!childrenChanged) {
    return node;
  }

  return {
    ...node,
    properties: { ...node.properties },
    children,
  };
}

function decorateNode(
  node: ElementContent,
  context: DecorationContext
): ElementContent | ElementContent[] {
  if (node.type === 'text') {
    return decorateText(node, context);
  }
  if (node.type === 'element') {
    return decorateElement(node, context);
  }
  return node;
}

function decorateText(
  node: Text,
  context: DecorationContext
): ElementContent | ElementContent[] {
  const { value } = node;
  const textStart = context.offset;
  const textEnd = textStart + value.length;
  const segments: ElementContent[] = [];
  let localOffset = 0;

  while (context.rangeIndex < context.ranges.length) {
    const range = context.ranges[context.rangeIndex];
    if (range == null) {
      break;
    }
    if (range.end <= textStart + localOffset) {
      context.rangeIndex++;
      continue;
    }
    if (range.start >= textEnd) {
      break;
    }

    if (range.start > textStart + localOffset) {
      const segmentEnd = range.start - textStart;
      pushTextSegment(segments, value.slice(localOffset, segmentEnd));
      localOffset = segmentEnd;
      continue;
    }

    const segmentEnd = Math.min(value.length, range.end - textStart);
    pushSearchSegment(
      segments,
      value.slice(localOffset, segmentEnd),
      range.current
    );
    localOffset = segmentEnd;
    if (textStart + localOffset >= range.end) {
      context.rangeIndex++;
    }
  }

  if (localOffset < value.length) {
    pushTextSegment(segments, value.slice(localOffset));
  }

  context.offset = textEnd;
  if (segments.length === 0) {
    return node;
  }

  context.changed = true;
  return segments;
}

function pushTextSegment(segments: ElementContent[], value: string): void {
  if (value.length === 0) {
    return;
  }
  segments.push(createTextNodeElement(value));
}

function pushSearchSegment(
  segments: ElementContent[],
  value: string,
  current: boolean
): void {
  if (value.length === 0) {
    return;
  }
  segments.push(
    createHastElement({
      tagName: 'span',
      properties: {
        'data-search-match': '',
        'data-search-match-current': current ? '' : undefined,
      },
      children: [createTextNodeElement(value)],
    })
  );
}
