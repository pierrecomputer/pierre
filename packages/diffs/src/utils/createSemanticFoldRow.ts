import type { Element as HASTElement, Properties } from 'hast';

import type { SVGSpriteNames } from '../sprite';
import type {
  LineTypes,
  SemanticDiffFold,
  SemanticDiffFoldCounts,
} from '../types';
import {
  createHastElement,
  createIconElement,
  createTextNodeElement,
} from './hast_utils';

// TODO: Figure out how to internationalize this...
function formatLineCount(count: number): string {
  return `${count} ${count === 1 ? 'line' : 'lines'}`;
}

// The summary a closed fold of moved code shows in place of its lines, such
// as "Moved 3 lines, edited 1 line". Every old line in the fold counts once,
// so the moved total covers the whole fold; edits and removals inside it
// follow when there are any.
export function formatSemanticFoldSummary({
  moved,
  edited,
  removed,
}: SemanticDiffFoldCounts): string {
  const parts = [`Moved ${formatLineCount(moved + edited + removed)}`];
  if (edited > 0) parts.push(`edited ${formatLineCount(edited)}`);
  if (removed > 0) parts.push(`removed ${formatLineCount(removed)}`);
  return parts.join(', ');
}

// The gutter cell of a closed fold's row: the icon its first line shows when
// open, the summary, and the button that opens it. The label overflows into
// the content column. Pressing anywhere on the row opens the fold; once open,
// its lines render as usual and the icon on its first line closes it again.
export function createSemanticFoldGutter(
  fold: SemanticDiffFold,
  lineType: LineTypes,
  icon: SVGSpriteNames
): HASTElement {
  return createHastElement({
    tagName: 'div',
    properties: {
      'data-gutter-buffer': 'semantic-fold',
      'data-semantic-fold-toggle': fold.old.start,
      'data-line-type': lineType,
    },
    children: [
      createHastElement({
        tagName: 'div',
        properties: { 'data-semantic-fold-label': '' },
        children: [
          createIconElement({
            name: icon,
            properties: {
              'data-semantic-fold-icon': '',
              'aria-hidden': 'true',
            },
          }),
          createHastElement({
            tagName: 'span',
            properties: { 'data-semantic-fold-summary': '' },
            children: [
              createTextNodeElement(formatSemanticFoldSummary(fold.counts)),
            ],
          }),
          createHastElement({
            tagName: 'button',
            properties: {
              type: 'button',
              'data-semantic-fold-button': '',
              'data-semantic-fold-toggle': fold.old.start,
              'data-focus-key': getSemanticFoldFocusKey(fold),
              'aria-expanded': 'false',
              'aria-label': 'Expand moved lines',
            },
            children: [
              createIconElement({
                name: 'diffs-icon-expand-all',
                properties: {
                  'data-semantic-fold-icon': '',
                  'aria-hidden': 'true',
                },
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// The content cell of a closed fold's row. It stands in for the fold's old
// lines, so connector measurement can end their bands on it.
export function createSemanticFoldContent(
  fold: SemanticDiffFold,
  lineType: LineTypes
): HASTElement {
  return createHastElement({
    tagName: 'div',
    properties: {
      'data-semantic-fold': '',
      'data-semantic-fold-start': fold.old.start,
      'data-semantic-fold-end': fold.old.end,
      'data-semantic-fold-toggle': fold.old.start,
      'data-line-type': lineType,
    },
  });
}

// Properties of the button around an open fold's first-line icon, which
// closes the fold again.
export function getSemanticFoldCloseButtonProperties(
  fold: SemanticDiffFold
): Properties {
  return {
    'data-semantic-fold-toggle': fold.old.start,
    'data-focus-key': getSemanticFoldFocusKey(fold),
    'aria-expanded': 'true',
    'aria-label': 'Collapse moved lines',
  };
}

// A fold's open and close buttons share a focus key, so focus moves from one
// to the other when the fold toggles.
function getSemanticFoldFocusKey(fold: SemanticDiffFold): string {
  return `semantic-fold:${fold.old.start}`;
}
