import type { ElementContent, Element as HASTElement } from 'hast';

import { i18n } from '../i18n/I18n';
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
  /** Set on a `foldedRanges` separator; carries the host's range index. */
  foldIndex?: number;
  foldExpanded?: boolean;
  chunked?: boolean;
  slotName?: string;
  isFirstHunk: boolean;
  isLastHunk: boolean;
}

function createFoldButton(expanded: boolean) {
  return createHastElement({
    tagName: 'div',
    children: [
      createIconElement({
        name: 'diffs-icon-expand',
        properties: { 'data-icon': '' },
      }),
    ],
    properties: {
      role: 'button',
      'aria-expanded': String(expanded),
      'data-expand-button': '',
    },
  });
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
  foldIndex,
  foldExpanded = false,
  chunked = false,
  slotName,
  isFirstHunk,
  isLastHunk,
}: CreateSeparatorProps): HASTElement {
  // A fold separator with a slot hands the whole row to the host, so none of
  // the built-in chrome renders and the row takes the `custom` shape.
  const customFold = foldIndex != null && slotName != null;
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
  if (
    !customFold &&
    (type === 'line-info' || type === 'line-info-basic') &&
    content != null
  ) {
    const contentChildren: ElementContent[] = [];
    if (foldIndex != null) {
      contentChildren.push(createFoldButton(foldExpanded));
      buttonCount++;
    } else if (expandIndex != null) {
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
          tagName: 'div',
          children: [createTextNodeElement(i18n.t('expandAll'))],
          properties: {
            role: 'button',
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
  if (customFold && slotName != null) {
    // Inside the wrapper so the row does not widen the gutter column.
    children.push(
      createHastElement({
        tagName: 'div',
        children: [
          createHastElement({
            tagName: 'slot',
            properties: { name: slotName },
          }),
        ],
        properties: { 'data-separator-wrapper': '' },
      })
    );
  } else if (type === 'custom' && slotName != null) {
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
      'data-separator': customFold
        ? 'custom'
        : children.length === 0
          ? 'simple'
          : type,
      'data-fold-index': foldIndex,
      'data-expand-index': expandIndex,
      'data-separator-first': isFirstHunk ? '' : undefined,
      'data-separator-last': isLastHunk ? '' : undefined,
    },
  });
}
