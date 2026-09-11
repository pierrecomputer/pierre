import {
  CORE_CSS_ATTRIBUTE,
  THEME_CSS_ATTRIBUTE,
  UNSAFE_CSS_ATTRIBUTE,
} from '../constants';
import { wrapCoreCSS, wrapUnsafeCSS } from './cssWrappers';
import { createHTMLElement } from './toHtml';

export function createStyleElement(
  content: string,
  isCoreCSS: boolean = false
): string {
  return createHTMLElement(
    'style',
    {
      [CORE_CSS_ATTRIBUTE]: isCoreCSS ? '' : undefined,
      [UNSAFE_CSS_ATTRIBUTE]: !isCoreCSS ? '' : undefined,
    },
    isCoreCSS ? wrapCoreCSS(content) : wrapUnsafeCSS(content)
  );
}

export function createThemeStyleElement(content: string): string {
  return createHTMLElement(
    'style',
    {
      [THEME_CSS_ATTRIBUTE]: '',
    },
    content
  );
}
