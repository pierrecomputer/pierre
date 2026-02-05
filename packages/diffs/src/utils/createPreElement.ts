import type { Element as HASTElement, Properties } from 'hast';

import type { PrePropertiesConfig } from '../types';
import { createHastElement } from './hast_utils';

export function createPreElement(options: PrePropertiesConfig): HASTElement {
  return createHastElement({
    tagName: 'pre',
    properties: createPreWrapperProperties(options),
  });
}

export function createPreWrapperProperties({
  diffIndicators,
  disableBackground,
  disableLineNumbers,
  overflow,
  split,
  themeType,
  themeStyles,
  totalLines,
  type,
}: PrePropertiesConfig): Properties {
  const properties: Properties = {
    'data-diff': type === 'diff' ? '' : undefined,
    'data-file': type === 'file' ? '' : undefined,
    'data-diff-type':
      type === 'diff' ? (split ? 'split' : 'single') : undefined,
    'data-overflow': overflow,
    'data-disable-line-numbers': disableLineNumbers ? '' : undefined,
    'data-background': !disableBackground ? '' : undefined,
    'data-indicators':
      diffIndicators === 'bars' || diffIndicators === 'classic'
        ? diffIndicators
        : undefined,
    'data-theme-type': themeType !== 'system' ? themeType : undefined,
    // NOTE(amadeus): Alex, here we would probably set a class property
    // instead, when that's working and supported
    style: themeStyles,
    tabIndex: 0,
  };
  properties.style += `--diffs-min-number-column-width-default:${`${totalLines}`.length}ch;`;

  return properties;
}
