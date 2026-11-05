import type { Element as HASTElement } from 'hast';

import {
  CORE_CSS_ATTRIBUTE,
  THEME_CSS_ATTRIBUTE,
  UNSAFE_CSS_ATTRIBUTE,
} from '../constants';
import { wrapCoreCSS, wrapUnsafeCSS } from './cssWrappers';
import { createHastElement, createTextNodeElement } from './hast_utils';

/** The base stylesheet server-rendered markup carries until it hydrates. */
export function createCoreStyleElement(): HASTElement {
  return createHastElement({
    tagName: 'style',
    children: [createTextNodeElement(wrapCoreCSS())],
    properties: {
      [CORE_CSS_ATTRIBUTE]: '',
    },
  });
}

export function createStyleElement(unsafeCSS: string): HASTElement {
  return createHastElement({
    tagName: 'style',
    children: [createTextNodeElement(wrapUnsafeCSS(unsafeCSS))],
    properties: {
      [UNSAFE_CSS_ATTRIBUTE]: '',
    },
  });
}

export function createThemeStyleElement(content: string): HASTElement {
  return createHastElement({
    tagName: 'style',
    children: [createTextNodeElement(content)],
    properties: {
      [THEME_CSS_ATTRIBUTE]: '',
    },
  });
}
