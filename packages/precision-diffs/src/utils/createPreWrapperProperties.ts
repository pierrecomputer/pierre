import type { Properties } from 'hast';

import type { PJSHighlighter, PrePropertiesConfig } from '../types';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';

export interface CreatePreWrapperPropertiesProps extends PrePropertiesConfig {
  highlighter: PJSHighlighter;
}

export function createPreWrapperProperties({
  diffIndicators,
  disableBackground,
  disableLineNumbers,
  highlighter,
  overflow,
  split,
  theme,
  themeType,
  totalLines,
}: CreatePreWrapperPropertiesProps): Properties {
  const properties: Properties = {
    'data-pjs': '',
    'data-type': split ? 'split' : 'file',
    'data-overflow': overflow,
    'data-disable-line-numbers': disableLineNumbers ? '' : undefined,
    'data-background': !disableBackground ? '' : undefined,
    'data-indicators':
      diffIndicators === 'bars' || diffIndicators === 'classic'
        ? diffIndicators
        : undefined,
    // NOTE(amadeus): Alex, here we would probably set a class property
    // instead, when that's working and supported
    style: getHighlighterThemeStyles({ theme, highlighter }),
    tabIndex: 0,
  };
  properties.style += `--pjs-min-number-column-width-default:${`${totalLines}`.length}ch;`;

  if (typeof theme === 'string' && themeType !== 'system') {
    properties['data-theme-type'] = themeType;
  } else if (typeof theme === 'string') {
    const themeData = highlighter.getTheme(theme);
    properties['data-theme-type'] = themeData.type;
  }

  return properties;
}
