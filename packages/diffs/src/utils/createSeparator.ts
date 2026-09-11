import type { ExpansionDirections, HunkSeparators } from '../types';
import { createHTMLElement, createIconElement, escapeHTML } from './toHtml';

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
  return createHTMLElement(
    'div',
    {
      role: 'button',
      'data-expand-button': '',
      'data-expand-both': type === 'both' ? '' : undefined,
      'data-expand-up': type === 'up' ? '' : undefined,
      'data-expand-down': type === 'down' ? '' : undefined,
    },
    createIconElement({
      name: type === 'both' ? 'diffs-icon-expand-all' : 'diffs-icon-expand',
      properties: { 'data-icon': '' },
    })
  );
}

export function createSeparator({
  type,
  content,
  expandIndex,
  chunked = false,
  slotName,
  isFirstHunk,
  isLastHunk,
}: CreateSeparatorProps): string {
  let buttonCount = 0;
  const children = [];
  if (type === 'metadata' && content != null) {
    children.push(
      createHTMLElement(
        'div',
        { 'data-separator-wrapper': '' },
        escapeHTML(content)
      )
    );
  }
  if ((type === 'line-info' || type === 'line-info-basic') && content != null) {
    const contentChildren: string[] = [];
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
      createHTMLElement(
        'div',
        { 'data-separator-content': '' },
        createHTMLElement(
          'span',
          { 'data-unmodified-lines': '' },
          escapeHTML(content)
        )
      )
    );
    if (chunked && expandIndex != null) {
      contentChildren.push(
        createHTMLElement(
          'div',
          {
            role: 'button',
            'data-expand-button': '',
            'data-expand-all-button': '',
          },
          escapeHTML('Expand all')
        )
      );
    }
    children.push(
      createHTMLElement(
        'div',
        {
          'data-separator-wrapper': '',
          'data-separator-multi-button': buttonCount > 1 ? '' : undefined,
        },
        ...contentChildren
      )
    );
  }
  if (type === 'custom' && slotName != null) {
    children.push(createHTMLElement('slot', { name: slotName }));
  }
  return createHTMLElement(
    'div',
    {
      'data-separator': children.length === 0 ? 'simple' : type,
      'data-expand-index': expandIndex,
      'data-separator-first': isFirstHunk ? '' : undefined,
      'data-separator-last': isLastHunk ? '' : undefined,
    },
    ...children
  );
}
