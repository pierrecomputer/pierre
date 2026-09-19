import type {
  ElementContent,
  ExpansionDirections,
  HElement as HtmlElement,
  HunkSeparators,
} from '../types';
import { createHtmlElement, createIconElement, createTextNode } from './html';

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
  return createHtmlElement({
    tagName: 'div',
    children: [
      createIconElement({
        name: type === 'both' ? 'diffs-icon-expand-all' : 'diffs-icon-expand',
        properties: { 'data-icon': '' },
      }),
    ],
    properties: {
      role: 'button',
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
}: CreateSeparatorProps): HtmlElement {
  let buttonCount = 0;
  const children = [];
  if (type === 'metadata' && content != null) {
    children.push(
      createHtmlElement({
        tagName: 'div',
        children: [createTextNode(content)],
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
      createHtmlElement({
        tagName: 'div',
        children: [
          createHtmlElement({
            tagName: 'span',
            children: [createTextNode(content)],
            properties: { 'data-unmodified-lines': '' },
          }),
        ],
        properties: { 'data-separator-content': '' },
      })
    );
    if (chunked && expandIndex != null) {
      contentChildren.push(
        createHtmlElement({
          tagName: 'div',
          children: [createTextNode('Expand all')],
          properties: {
            role: 'button',
            'data-expand-button': '',
            'data-expand-all-button': '',
          },
        })
      );
    }
    children.push(
      createHtmlElement({
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
      createHtmlElement({
        tagName: 'slot',
        properties: { name: slotName },
      })
    );
  }
  return createHtmlElement({
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
