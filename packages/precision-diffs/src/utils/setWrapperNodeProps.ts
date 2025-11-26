import { DEFAULT_THEMES } from '../constants';
import type {
  PJSHighlighter,
  PJSThemeNames,
  ThemeTypes,
  ThemesType,
} from '../types';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';

export interface SetupWrapperNodeProps {
  theme?: PJSThemeNames | ThemesType;
  pre: HTMLPreElement;
  highlighter: PJSHighlighter;
  split: boolean;
  wrap: boolean;
  themeType: ThemeTypes;
  diffIndicators: 'bars' | 'classic' | 'none';
  disableBackground: boolean;
  totalLines: number;
}

export function setWrapperNodeProps({
  pre,
  highlighter,
  theme = DEFAULT_THEMES,
  split,
  wrap,
  themeType,
  diffIndicators,
  disableBackground,
  totalLines,
}: SetupWrapperNodeProps): HTMLPreElement {
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
  if (disableBackground) {
    delete pre.dataset.background;
  } else {
    pre.dataset.background = '';
  }
  pre.dataset.type = split ? 'split' : 'file';
  pre.dataset.overflow = wrap ? 'wrap' : 'scroll';
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
