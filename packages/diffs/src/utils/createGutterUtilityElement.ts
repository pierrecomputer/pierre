import { createHTMLElement, createIconElement } from './toHtml';

export function createGutterUtilityElement(): string {
  return createHTMLElement(
    'button',
    { 'data-utility-button': '', type: 'button' },
    createIconElement({
      name: 'diffs-icon-plus',
      properties: { 'data-icon': '' },
    })
  );
}
