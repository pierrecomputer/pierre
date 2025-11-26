import type { Element as HASTElement } from 'hast';

import { createHastElement, createTextNodeElement } from './hast_utils';

export function createStyleElement(content: string): HASTElement {
  return createHastElement({
    tagName: 'style',
    children: [createTextNodeElement(content)],
  });
}
