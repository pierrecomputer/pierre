import type { ElementContent, Element as HASTElement } from 'hast';

import type { ExpansionDirections, HunkSeparators } from '../types';
import {
  createHastElement,
  createIconElement,
  createTextNodeElement,
} from './hast_utils';

interface CreateSeparatorProps {
  type: HunkSeparators;
  content?: string;
  expandIndex?: number;
  chunked?: boolean;
  slotName?: string;
  isFirstHunk: boolean;
  isLastHunk: boolean;
}

function createExpandButton(type: ExpansionDirections) {
  return createHastElement({
    tagName: 'div',
    children: [
      createIconElement({
        name: type === 'both' ? 'diffs-icon-expand-all' : 'diffs-icon-expand',
        properties: { 'data-icon': '' },
      }),
    ],
    properties: {
      'data-expand-button': '',
      'data-expand-both': type === 'both' ? '' : undefined,
      'data-expand-up': type === 'up' ? '' : undefined,
      'data-expand-down': type === 'down' ? '' : undefined,
    },
  });
}

export function createSeparator({
  type,
  content,
  expandIndex,
  chunked = false,
  slotName,
  isFirstHunk,
  isLastHunk,
}: CreateSeparatorProps): HASTElement {
  let buttonCount = 0;
  const children = [];
  if (type === 'metadata' && content != null) {
    children.push(
      createHastElement({
        tagName: 'div',
        children: [createTextNodeElement(content)],
        properties: { 'data-separator-wrapper': '' },
      })
    );
  }
  if ((type === 'line-info' || type === 'line-info-basic') && content != null) {
    const contentChildren: ElementContent[] = [];
    if (expandIndex != null) {
      if (!chunked) {
        contentChildren.push(
          createExpandButton(
            !isFirstHunk && !isLastHunk ? 'both' : isFirstHunk ? 'down' : 'up'
          )
        );
        buttonCount++;
      } else {
        if (!isFirstHunk) {
          contentChildren.push(createExpandButton('up'));
          buttonCount++;
        }
        if (!isLastHunk) {
          contentChildren.push(createExpandButton('down'));
          buttonCount++;
        }
      }
    }
    contentChildren.push(
      createHastElement({
        tagName: 'div',
        children: [
          createHastElement({
            tagName: 'span',
            children: [createTextNodeElement(content)],
            properties: { 'data-unmodified-lines': '' },
          }),
        ],
        properties: { 'data-separator-content': '' },
      })
    );
    if (chunked && expandIndex != null) {
      contentChildren.push(
        createHastElement({
          tagName: 'span',
          children: [createTextNodeElement('Expand All')],
          properties: {
            'data-expand-button': '',
            'data-expand-all-button': '',
          },
        })
      );
    }
    children.push(
      createHastElement({
        tagName: 'div',
        children: contentChildren,
        properties: {
          'data-separator-wrapper': '',
          'data-separator-multi-button': buttonCount > 1 ? '' : undefined,
        },
      })
    );
  }
  if (type === 'custom' && slotName != null) {
    children.push(
      createHastElement({
        tagName: 'slot',
        properties: { name: slotName },
      })
    );
  }
  return createHastElement({
    tagName: 'div',
    children,
    properties: {
      'data-separator': children.length === 0 ? 'simple' : type,
      'data-expand-index': expandIndex,
      'data-separator-first': isFirstHunk ? '' : undefined,
      'data-separator-last': isLastHunk ? '' : undefined,
    },
  });
}
