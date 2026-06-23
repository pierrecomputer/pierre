import { DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY } from '../constants';
import rawStyles from '../style.css?inline';
import type { ThemeTypes } from '../types';
import { createMeasuredScrollbarGutterDeclaration } from './scrollbarGutter';

const LAYER_ORDER = `@layer base, theme, rendered, unsafe;`;
const SCROLLBAR_GUTTER_DECLARATION_PATTERN = new RegExp(
  `${escapeRegExp(DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY)}\\s*:\\s*[^;]+;`
);

export function wrapCoreCSS(mainCSS: string) {
  return `${LAYER_ORDER}
${rawStyles}
@layer theme {
  ${mainCSS}
}`;
}

export function wrapUnsafeCSS(unsafeCSS: string) {
  return `${LAYER_ORDER}
@layer unsafe {
  ${unsafeCSS}
}`;
}

export function wrapThemeCSS(
  themeCSS: string,
  themeType: ThemeTypes = 'system',
  scrollbarGutter?: number
) {
  const colorSchemeRule =
    themeType === 'system'
      ? ''
      : `
  color-scheme: ${themeType};`;
  const scrollbarGutterVar =
    createMeasuredScrollbarGutterDeclaration(scrollbarGutter);

  return `${LAYER_ORDER}
@layer rendered {
  :host {${colorSchemeRule}
  ${scrollbarGutterVar}
  ${themeCSS}
  }
}`;
}

export function patchScrollbarGutterSize(
  themeCSS: string,
  scrollbarGutter: number | undefined
): string {
  const scrollbarGutterRule =
    createMeasuredScrollbarGutterDeclaration(scrollbarGutter);
  return themeCSS.replace(
    SCROLLBAR_GUTTER_DECLARATION_PATTERN,
    scrollbarGutterRule
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
