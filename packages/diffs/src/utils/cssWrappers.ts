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
  const tokenFontStyles = (
    themeType === 'system' ? ['light', 'dark'] : [themeType]
  )
    .map((type) => {
      const styles = `
  [data-line] span, [data-edit-prediction-suffix] span {
    font-weight: var(--diffs-token-${type}-font-weight, inherit);
    font-style: var(--diffs-token-${type}-font-style, inherit);
    text-decoration: var(--diffs-token-${type}-text-decoration, inherit);
  }`;
      return themeType === 'system' && type === 'dark'
        ? `@media (prefers-color-scheme: dark) {${styles}\n}`
        : styles;
    })
    .join('\n');

  return `${LAYER_ORDER}
@layer base {
  ${tokenFontStyles}
}
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
