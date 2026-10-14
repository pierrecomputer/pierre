import type {
  ElementContent,
  Element as HASTElement,
  Properties,
  Root,
  RootContent,
  Text,
} from 'hast';

import type { SVGSpriteNames } from '../sprite';
import type { LineTypes } from '../types';

export function createTextNodeElement(value: string): Text {
  return { type: 'text', value };
}

interface CreateHastElementProps {
  tagName:
    | 'span'
    | 'div'
    | 'button'
    | 'code'
    | 'pre'
    | 'slot'
    | 'svg'
    | 'use'
    | 'style'
    | 'template'
    | 'bdi';
  children?: ElementContent[];
  properties?: Properties;
}

export function createHastElement({
  tagName,
  children = [],
  properties = {},
}: CreateHastElementProps): HASTElement {
  return {
    type: 'element',
    tagName,
    properties,
    children,
  };
}

interface CreateIconProps {
  name: SVGSpriteNames;
  width?: number;
  height?: number;
  properties?: Properties;
}

export function createIconElement({
  name,
  width = 16,
  height = 16,
  properties,
}: CreateIconProps): HASTElement {
  return createHastElement({
    tagName: 'svg',
    properties: { width, height, viewBox: '0 0 16 16', ...properties },
    children: [
      createHastElement({
        tagName: 'use',
        properties: { href: `#${name.replace(/^#/, '')}` },
      }),
    ],
  });
}

export function findCodeElement(
  nodes: Root | HASTElement
): HASTElement | undefined {
  let firstChild: RootContent | HASTElement | Root | null = nodes.children[0];
  while (firstChild != null) {
    if (firstChild.type === 'element' && firstChild.tagName === 'code') {
      return firstChild;
    }
    if ('children' in firstChild) {
      firstChild = firstChild.children[0];
    } else {
      firstChild = null;
    }
  }
  return undefined;
}

export function createGutterWrapper(children?: ElementContent[]): HASTElement {
  return createHastElement({
    tagName: 'div',
    properties: { 'data-gutter': '' },
    children,
  });
}

// A gutter cell holding a line number. An optional icon is placed before the
// number; semantic diffs use it to mark the first row of a change region.
export function createGutterItem(
  lineType: LineTypes | 'buffer' | 'separator' | 'annotation',
  lineNumber: number,
  lineIndex: string,
  properties: Properties = {},
  icon?: SVGSpriteNames
): HASTElement {
  const children: ElementContent[] = [];
  if (icon != null) {
    children.push(
      createIconElement({
        name: icon,
        properties: { 'data-semantic-icon': '', 'aria-hidden': 'true' },
      })
    );
  }
  if (lineNumber != null) {
    children.push(
      createHastElement({
        tagName: 'span',
        properties: { 'data-line-number-content': '' },
        children: [createTextNodeElement(`${lineNumber}`)],
      })
    );
  }
  return createHastElement({
    tagName: 'div',
    properties: {
      'data-line-type': lineType,
      'data-column-number': lineNumber,
      'data-line-index': lineIndex,
      ...properties,
    },
    children: children.length > 0 ? children : undefined,
  });
}

export function createGutterGap(
  type: LineTypes | undefined,
  bufferType: 'annotation' | 'buffer' | 'metadata',
  size: number
): HASTElement {
  return createHastElement({
    tagName: 'div',
    properties: {
      'data-gutter-buffer': bufferType,
      'data-buffer-size': size,
      'data-line-type': type,
      style:
        bufferType === 'annotation'
          ? `grid-row: span ${size};`
          : `grid-row: span ${size};min-height:calc(${size} * 1lh);`,
    },
  });
}
