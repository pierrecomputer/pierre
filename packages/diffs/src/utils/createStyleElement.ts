import {
  CORE_CSS_ATTRIBUTE,
  THEME_CSS_ATTRIBUTE,
  UNSAFE_CSS_ATTRIBUTE,
} from '../constants';
import type { HElement as HtmlElement } from '../types';
import { wrapCoreCSS, wrapUnsafeCSS } from './cssWrappers';
import { createHtmlElement, createTextNode } from './html';

export function createStyleElement(
  content: string,
  isCoreCSS: boolean = false
): HtmlElement {
  return createHtmlElement({
    tagName: 'style',
    children: [
      createTextNode(isCoreCSS ? wrapCoreCSS(content) : wrapUnsafeCSS(content)),
    ],
    properties: {
      [CORE_CSS_ATTRIBUTE]: isCoreCSS ? '' : undefined,
      [UNSAFE_CSS_ATTRIBUTE]: !isCoreCSS ? '' : undefined,
    },
  });
}

export function createThemeStyleElement(content: string): HtmlElement {
  return createHtmlElement({
    tagName: 'style',
    children: [createTextNode(content)],
    properties: {
      [THEME_CSS_ATTRIBUTE]: '',
    },
  });
}
