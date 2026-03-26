import rawStyles from '../style.css';
import type { ThemeTypes } from '../types';

const LAYER_ORDER = `@layer base, theme, rendered, unsafe;`;

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
  themeType: ThemeTypes = 'system'
) {
  const colorSchemeRule =
    themeType === 'system'
      ? ''
      : `
  color-scheme: ${themeType};`;

  return `${LAYER_ORDER}
@layer rendered {
  :host {${colorSchemeRule}
  ${themeCSS}
  }
}`;
}
