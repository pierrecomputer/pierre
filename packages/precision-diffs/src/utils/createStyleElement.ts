import type { Element as HASTElement } from 'hast';

import { CORE_CSS_ATTRIBUTE, UNSAFE_CSS_ATTRIBUTE } from '../constants';
import { wrapCoreCSS, wrapUnsafeCSS } from './cssWrappers';
import { createHastElement, createTextNodeElement } from './hast_utils';

export function createStyleElement(
  content: string,
  isCoreCSS: boolean = false
): HASTElement {
  return createHastElement({
    tagName: 'style',
    children: [
      createTextNodeElement(
        isCoreCSS ? wrapCoreCSS(content) : wrapUnsafeCSS(content)
      ),
    ],
    properties: {
      [CORE_CSS_ATTRIBUTE]: isCoreCSS ? '' : undefined,
      [UNSAFE_CSS_ATTRIBUTE]: !isCoreCSS ? '' : undefined,
    },
  });
}
