import type { PJSHighlighter, PrePropertiesConfig } from '../types';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';

export interface SetPreNodePropertiesProps extends PrePropertiesConfig {
  pre: HTMLPreElement;
  highlighter: PJSHighlighter;
}

export function setPreNodeProperties({
  diffIndicators,
  disableBackground,
  disableLineNumbers,
  highlighter,
  overflow,
  pre,
  split,
  theme,
  themeType,
  totalLines,
}: SetPreNodePropertiesProps): HTMLPreElement {
  // Get theme color custom properties (e.g., --pjs-fg, --pjs-bg)
  const styles = getHighlighterThemeStyles({ theme, highlighter });

  if (themeType === 'system') {
    delete pre.dataset.themeType;
  } else {
    pre.dataset.themeType = themeType;
  }
  if (typeof theme === 'string') {
    const themeData = highlighter.getTheme(theme);
    pre.dataset.themeType = themeData.type;
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
  pre.style = styles;
  // Set CSS custom property for line number column width
  pre.style.setProperty(
    '--pjs-min-number-column-width-default',
    `${`${totalLines}`.length}ch`
  );
  return pre;
}
