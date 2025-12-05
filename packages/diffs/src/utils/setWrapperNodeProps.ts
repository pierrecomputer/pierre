import type { PrePropertiesConfig } from '../types';

export interface SetPreNodePropertiesProps extends PrePropertiesConfig {
  pre: HTMLPreElement;
}

export function setPreNodeProperties({
  diffIndicators,
  disableBackground,
  disableLineNumbers,
  overflow,
  pre,
  split,
  themeStyles,
  themeType,
  totalLines,
}: SetPreNodePropertiesProps): HTMLPreElement {
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
  pre.dataset.pjs = '';
  pre.tabIndex = 0;
  // Set theme color custom properties as inline styles on pre element
  pre.style = themeStyles;
  // Set CSS custom property for line number column width
  pre.style.setProperty(
    '--pjs-min-number-column-width-default',
    `${`${totalLines}`.length}ch`
  );
  return pre;
}
