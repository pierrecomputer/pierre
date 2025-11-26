import type { Properties } from 'hast';

import { DEFAULT_THEMES } from '../constants';
import type { CreatePreWrapperPropertiesProps } from '../types';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';

export function createPreWrapperProperties({
  diffIndicators = 'bars',
  disableBackground = false,
  highlighter,
  overflow = 'scroll',
  split,
  theme = DEFAULT_THEMES,
  themeType = 'system',
  totalLines,
}: CreatePreWrapperPropertiesProps): Properties {
  const properties: Properties = {
    'data-pjs': '',
    'data-type': split ? 'split' : 'file',
    'data-overflow': overflow,
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

  switch (diffIndicators) {
    case 'bars':
    case 'classic':
      properties['data-indicators'] = diffIndicators;
      break;
  }

  if (!disableBackground) {
    properties['data-background'] = '';
  }

  return properties;
}
