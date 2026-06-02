import type { Element as HASTElement } from 'hast';

import { createHastElement, createIconElement } from './hast_utils';

const GUTTER_UTILITY_LABEL = 'Add line annotation';

export function createGutterUtilityButtonElement(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.utilityButton = '';
  button.setAttribute('aria-label', GUTTER_UTILITY_LABEL);
  button.title = GUTTER_UTILITY_LABEL;

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.dataset.icon = '';
  icon.setAttribute('width', '16');
  icon.setAttribute('height', '16');
  icon.setAttribute('viewBox', '0 0 16 16');

  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#diffs-icon-plus');
  icon.append(use);
  button.append(icon);

  return button;
}

export function createGutterUtilityElement(): HASTElement {
  return createHastElement({
    tagName: 'button',
    properties: {
      'aria-label': GUTTER_UTILITY_LABEL,
      'data-utility-button': '',
      title: GUTTER_UTILITY_LABEL,
      type: 'button',
    },
    children: [
      createIconElement({
        name: 'diffs-icon-plus',
        properties: { 'data-icon': '' },
      }),
    ],
  });
}
