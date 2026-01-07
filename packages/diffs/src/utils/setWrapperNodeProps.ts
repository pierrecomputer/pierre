import type { PrePropertiesConfig } from '../types';

export function setPreNodeProperties(
  pre: HTMLPreElement,
  {
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
  if (themeType === 'system') {
    delete pre.dataset.themeType;
  } else {
    pre.dataset.themeType = themeType;
  }
  switch (diffIndicators) {
    case 'bars':
    case 'classic':
      pre.dataset.indicators = diffIndicators;
      break;
    case 'none':
      delete pre.dataset.indicators;
      break;
  }
  if (disableLineNumbers) {
    pre.dataset.disableLineNumbers = '';
  } else {
    delete pre.dataset.disableLineNumbers;
  }
  if (disableBackground) {
    delete pre.dataset.background;
  } else {
    pre.dataset.background = '';
  }
  pre.dataset.type = split ? 'split' : 'file';
  pre.dataset.overflow = overflow;
  pre.dataset.diffs = '';
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
