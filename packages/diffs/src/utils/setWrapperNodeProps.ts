import type { PrePropertiesConfig } from '../types';

export function setPreNodeProperties(
  pre: HTMLPreElement,
  {
    type,
    diffIndicators,
    disableBackground,
    disableLineNumbers,
    overflow,
    split,
    themeStyles,
    themeType,
    totalLines,
  }: PrePropertiesConfig
): HTMLPreElement {
  if (type === 'diff') {
    pre.setAttribute('data-diff', '');
    pre.removeAttribute('data-file');
  } else {
    pre.setAttribute('data-file', '');
    pre.removeAttribute('data-diff');
  }
  if (themeType === 'system') {
    pre.removeAttribute('data-theme-type');
  } else {
    pre.setAttribute('data-theme-type', themeType);
  }
  switch (diffIndicators) {
    case 'bars':
    case 'classic':
      pre.setAttribute('data-indicators', diffIndicators);
      break;
    case 'none':
      pre.removeAttribute('data-indicators');
      break;
  }
  if (disableLineNumbers) {
    pre.setAttribute('data-disable-line-numbers', '');
  } else {
    pre.removeAttribute('data-disable-line-numbers');
  }
  if (disableBackground) {
    pre.removeAttribute('data-background');
  } else {
    pre.setAttribute('data-background', '');
  }
  if (type === 'diff') {
    pre.setAttribute('data-diff-type', split ? 'split' : 'single');
  } else {
    pre.removeAttribute('data-diff-type');
  }
  pre.setAttribute('data-overflow', overflow);
  pre.tabIndex = 0;
  // Set theme color custom properties as inline styles on pre element
  pre.style = themeStyles;
  // Set CSS custom property for line number column width
  pre.style.setProperty(
    '--diffs-min-number-column-width-default',
    `${`${totalLines}`.length}ch`
  );
  return pre;
}
