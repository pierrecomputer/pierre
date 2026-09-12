import type { Element as HASTElement } from 'hast';

import { createHastElement, createIconElement } from './hast_utils';

export function createGutterUtilityElement(): HASTElement {
  return createHastElement({
    tagName: 'button',
    properties: { 'data-utility-button': '', type: 'button' },
    children: [
      createIconElement({
        name: 'diffs-icon-plus',
        properties: { 'data-icon': '' },
      }),
    ],
  });
}
