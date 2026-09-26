import type { Element as HASTElement } from 'hast';

import { createHastElement } from './hast_utils';

export type FoldIconNames = 'chevron-down' | 'chevron-right' | 'ellipsis';

// Fold controls render the same markup whether the read-only renderer emits
// them as HAST or the editor patches them into the DOM, so an editor attaching
// to an already-rendered file can adopt the existing buttons in place. The
// icons reference the base sprite (always present in the component shadow
// root) and omit an outer viewBox so each symbol scales to the requested size.
export const getFoldIconSvg = (name: FoldIconNames, size = 16): string =>
  `<svg width="${size}" height="${size}" aria-hidden="true" focusable="false"><use href="#diffs-icon-fold-${name}"></use></svg>`;

export const FOLD_TOGGLE_ICON_SIZE = 14;
export const FOLD_ELLIPSIS_ICON_SIZE = 12;

function createFoldIconElement(name: FoldIconNames, size: number): HASTElement {
  return createHastElement({
    tagName: 'svg',
    properties: {
      width: size,
      height: size,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    children: [
      createHastElement({
        tagName: 'use',
        properties: { href: `#diffs-icon-fold-${name}` },
      }),
    ],
  });
}

/**
 * Gutter fold control for a foldable line: an absolutely-positioned zone with
 * the chevron toggle button, appended inside the line's gutter cell.
 */
export function createFoldToggleElement(
  lineIndex: number,
  folded: boolean
): HASTElement {
  return createHastElement({
    tagName: 'span',
    properties: { 'data-fold': '' },
    children: [
      createHastElement({
        tagName: 'button',
        properties: {
          'data-fold-toggle': '',
          type: 'button',
          'data-folded': folded ? '' : undefined,
          'aria-expanded': folded ? 'false' : 'true',
          'aria-label': `${folded ? 'Unfold' : 'Fold'} line ${lineIndex + 1}`,
          title: folded ? 'Unfold' : 'Fold',
        },
        children: [
          createFoldIconElement(
            folded ? 'chevron-right' : 'chevron-down',
            FOLD_TOGGLE_ICON_SIZE
          ),
        ],
      }),
    ],
  });
}

/**
 * Inline indicator appended after a folded line's content: an ellipsis button
 * that unfolds the hidden block.
 */
export function createFoldIndicatorElement(lineIndex: number): HASTElement {
  return createHastElement({
    tagName: 'span',
    properties: { 'data-fold-indicator': '' },
    children: [
      createHastElement({
        tagName: 'button',
        properties: {
          'data-fold-ellipsis': '',
          type: 'button',
          'aria-label': `Unfold line ${lineIndex + 1}`,
          title: 'Unfold',
        },
        children: [createFoldIconElement('ellipsis', FOLD_ELLIPSIS_ICON_SIZE)],
      }),
    ],
  });
}
