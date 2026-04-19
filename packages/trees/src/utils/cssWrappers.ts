const STYLE_CLOSE_TAG_PATTERN = /<\/style/gi;
const LAYER_ORDER = `@layer base, unsafe;`;

export function wrapCoreCSS(coreCSS: string): string {
  return `${LAYER_ORDER}
@layer base {
  ${coreCSS}
}`;
}

export function wrapUnsafeCSS(unsafeCSS: string): string {
  return `${LAYER_ORDER}
@layer unsafe {
  ${unsafeCSS}
}`;
}

export function escapeStyleTextForHtml(css: string): string {
  return css.replace(STYLE_CLOSE_TAG_PATTERN, '<\\/style');
}
