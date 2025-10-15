import type {
  Element,
  ElementContent,
  Properties,
  Root,
  RootContent,
  Text,
} from 'hast';

import type { AnnotationSpan, SharedRenderState } from '../types';

export function createTextNode(value: string): Text {
  return { type: 'text', value };
}

interface CreateHastElementProps {
  tagName: 'span' | 'div' | 'slot' | 'svg' | 'use';
  children?: ElementContent[];
  properties?: Properties;
}

export function createHastElement({
  tagName,
  children = [],
  properties = {},
}: CreateHastElementProps): Element {
  return {
    type: 'element',
    tagName,
    properties,
    children,
  };
}

interface CreateSeparatorProps {
  type: 'empty' | 'metadata' | 'line-info';
  content?: string;
  expandIndex?: number;
}

export function createSeparator({
  type,
  content,
  expandIndex,
}: CreateSeparatorProps): Element {
  const children = [];
  if (type === 'metadata' && content != null) {
    children.push(
      createHastElement({
        tagName: 'div',
        children: [createTextNode(content)],
        properties: { 'data-separator-content': '' },
      })
    );
  }
  if (type === 'line-info' && content != null) {
    const contentChildren: ElementContent[] = [createTextNode(content)];
    if (expandIndex != null) {
      contentChildren.unshift(createIcon({ name: 'pjs-icon-expand' }));
    }
    children.push(
      createHastElement({
        tagName: 'div',
        children: contentChildren,
        properties: { 'data-separator-content': '' },
      })
    );
  }
  return createHastElement({
    tagName: 'div',
    children,
    properties: {
      'data-separator': children.length === 0 ? '' : type,
      'data-expand-index': expandIndex,
    },
  });
}

interface CreateIconProps {
  name: string;
  width?: number;
  height?: number;
}

export function createIcon({ name, width = 16, height = 16 }: CreateIconProps) {
  return createHastElement({
    tagName: 'svg',
    properties: { width, height, viewBox: '0 0 16 16' },
    children: [
      createHastElement({
        tagName: 'use',
        properties: { href: `#${name}` },
      }),
    ],
  });
}

export function createAnnotationElement(span: AnnotationSpan): Element {
  return createHastElement({
    tagName: 'div',
    children: [
      createHastElement({
        tagName: 'div',
        children: span.annotations?.map((slotId) =>
          createHastElement({ tagName: 'slot', properties: { name: slotId } })
        ),
        properties: { 'data-annotation-content': '' },
      }),
    ],
    properties: {
      'data-line-annotation': `${span.hunkIndex},${span.diffLineIndex}`,
    },
  });
}

export function createEmptyRowBuffer(size: number): Element {
  return createHastElement({
    tagName: 'div',
    properties: {
      'data-buffer': '',
      style: `grid-row: span ${size};min-height:calc(${size} * 1lh)`,
    },
  });
}

export function findCodeElement(nodes: Root | Element): Element | undefined {
  let firstChild: RootContent | Element | Root | null = nodes.children[0];
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

export function convertLine(
  node: Element,
  line: number,
  state: SharedRenderState
): ElementContent {
  const lineInfo = state.lineInfo[line];
  if (lineInfo == null) {
    throw new Error(`convertLine: line ${line}, contains no state.lineInfo`);
  }
  // We need to convert the current line to a div but keep all the decorations
  // that may be applied
  node.tagName = 'span';
  node.properties['data-column-content'] = '';
  if (lineInfo.metadataContent != null) {
    node.children.push(
      createHastElement({
        tagName: 'span',
        children: [createTextNode(lineInfo.metadataContent)],
        properties: { 'data-no-newline': '' },
      })
    );
  }
  // NOTE(amadeus): We need to push newline characters into empty rows or else
  // copy/pasta will have issues
  else if (node.children.length === 0) {
    node.children.push(createTextNode('\n'));
  }
  const children = [node];
  if (!state.disableLineNumbers) {
    children.unshift(
      createHastElement({
        tagName: 'span',
        children:
          lineInfo.metadataContent == null
            ? [{ type: 'text', value: `${lineInfo.number}` }]
            : [],
        properties: { 'data-column-number': '' },
      })
    );
  }
  return createHastElement({
    tagName: 'div',
    children,
    properties: {
      'data-line': lineInfo.metadataContent == null ? `${lineInfo.number}` : '',
      'data-line-type': lineInfo.type,
    },
  });
}
